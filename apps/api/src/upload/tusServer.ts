import { EVENTS, Server } from '@tus/server';
import { S3Store } from '@tus/s3-store';
import { nanoid } from 'nanoid';
import { eq } from 'drizzle-orm';
import { db } from '@/db/client.js';
import { files } from '@/db/schema.js';
import { BUCKET } from '@/storage/client.js';
import { fileProcessingQueue } from '@/queue/fileProcessing.js';

const endpoint = new URL(process.env.S3_ENDPOINT!);

function getUserId(req: { runtime?: { node?: { req: unknown } } }): string | null {
    return (req.runtime?.node?.req as { userId?: string | null } | undefined)?.userId ?? null;
}

const datastore = new S3Store({
    partSize: 8 * 1024 * 1024,
    s3ClientConfig: {
        bucket: BUCKET,
        endpoint: endpoint.origin,
        region: process.env.S3_REGION,
        forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
        credentials: {
            accessKeyId: process.env.S3_ACCESS_KEY!,
            secretAccessKey: process.env.S3_SECRET_KEY!,
        },
    },
});

// S3Store uses the tus upload id verbatim as the object key, so the prefix lives in the id.
// Upload URLs and files.id carry only the bare share id; the prefix is added back on the way in.
const UPLOAD_KEY_PREFIX = 'uploads/';

const toShareId = (uploadId: string) => uploadId.slice(UPLOAD_KEY_PREFIX.length);

export const tusServer = new Server({
    path: '/upload',
    datastore,
    // uploads/<share id> — the share id doubles as files.id, the full id as storageKey.
    namingFunction: () => `${UPLOAD_KEY_PREFIX}${nanoid(10)}`,
    generateUrl: (_req, { proto, host, path, id }) => `${proto}://${host}${path}/${toShareId(id)}`,
    getFileIdFromRequest: (_req, lastPath) => {
        // Mirrors tus's default guards, which a custom extractor bypasses.
        if (!lastPath || lastPath === 'upload' || /[\\\0]/.test(lastPath)) return undefined;
        return `${UPLOAD_KEY_PREFIX}${lastPath}`;
    },
    onUploadCreate: async (req, upload) => {
        if (!upload.size) {
            throw { status_code: 400, body: 'Upload-Length header is required\n' };
        }
        const filename = upload.metadata?.filename;
        if (!filename) {
            throw { status_code: 400, body: "Upload-Metadata must include 'filename'\n" };
        }

        const userId = getUserId(req);

        await db.insert(files).values({
            id: toShareId(upload.id),
            ownerId: userId,
            storageKey: upload.id,
            filename,
            contentType: upload.metadata?.filetype ?? null,
            sizeBytes: upload.size,
            fileStatus: 'uploading',
        });

        return {};
    },
    onUploadFinish: async (_req, upload) => {
        const fileId = toShareId(upload.id);
        await db.update(files).set({ fileStatus: 'uploaded' }).where(eq(files.id, fileId));
        // TODO: roll back if the enqueue fails — the row is already 'uploaded' and would never get processed.
        // A stable jobId makes BullMQ ignore a duplicate add for the same file. Prefixed because
        // BullMQ rejects purely numeric custom ids, which a nanoid can (rarely) be.
        await fileProcessingQueue.add('process-upload', { fileId }, { jobId: `process-upload-${fileId}` });
        return {};
    },
    // prevent tusServer from deleting finished files, this will be handled with a separate route which also cleans up other associated process like thumbs/previews
    disableTerminationForFinishedUploads: true,
    // Runs before HEAD/PATCH/DELETE touch storage. POST_TERMINATE fires only after the S3 delete.
    onIncomingRequest: async (req, id) => {
        // tus also calls this for POST with the freshly generated id, before onUploadCreate inserts the row.
        if (req.method === 'POST') return;

        const [file] = await db.select({ ownerId: files.ownerId }).from(files).where(eq(files.id, toShareId(id)));
        if (!file) {
            throw { status_code: 404, body: 'Upload not found\n' };
        }
        const userId = getUserId(req);
        if (!userId || file.ownerId !== userId) {
            throw { status_code: 403, body: 'You are not the owner of this upload\n' };
        }
    },
});

tusServer.on(EVENTS.POST_TERMINATE, async (_req, _res, id) => {
    await db.delete(files).where(eq(files.id, toShareId(id)))
})
