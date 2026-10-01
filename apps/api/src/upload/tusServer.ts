import { EVENTS, Server } from '@tus/server';
import { S3Store } from '@tus/s3-store';
import { nanoid } from 'nanoid';
import { eq } from 'drizzle-orm';
import { db } from '@/db/client.js';
import { files } from '@/db/schema.js';
import { BUCKET } from '@/storage/client.js';
import { fileProcessingQueue } from '@/queue/fileProcessing.js';
import { redisConnection } from '@/queue/connection.js';

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

export const tusServer = new Server({
    path: '/upload',
    datastore,
    // Reused as the files.id (share link id) and storageKey — one id, no separate mapping.
    namingFunction: () => nanoid(10),
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
            id: upload.id,
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
        await db.update(files).set({ fileStatus: 'uploaded' }).where(eq(files.id, upload.id));
        await fileProcessingQueue.add('process-upload', { fileId: upload.id });
        return {};
    },
    onIncomingRequest: async (req) => {
        if (req.method === 'PATCH') {
            // planning to do something here 
        }
    },
});

tusServer.on(EVENTS.POST_TERMINATE, (req, res, id) => {
    // finish termination logic later
})
