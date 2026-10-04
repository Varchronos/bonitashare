import { EVENTS, Server } from '@tus/server';
import { S3Store, type MetadataValue } from '@tus/s3-store';
import { nanoid } from 'nanoid';
import { eq } from 'drizzle-orm';
import { db } from '@/db/client.js';
import { files, users } from '@/db/schema.js';
import { BUCKET } from '@/storage/client.js';
import { fileProcessingQueue, PROCESS_UPLOAD_JOB, processUploadJobId } from '@/queue/fileProcessing.js';
import { Redis } from 'ioredis';
import { RedisLocker } from './redisLocker.js';
import { ExpiringRedisKvStore } from './redisKvStore.js';

const endpoint = new URL(process.env.S3_ENDPOINT!);

function getUserId(req: { runtime?: { node?: { req: unknown } } }): string | null {
    return (req.runtime?.node?.req as { userId?: string | null } | undefined)?.userId ?? null;
}

// Separate from the BullMQ connection: lock and metadata calls should fail fast, not retry forever.
// The subscriber needs its own connection because subscriber mode blocks other commands.
const tusRedis = new Redis(process.env.REDIS_URL!, { maxRetriesPerRequest: 2 });
const lockSubscriber = new Redis(process.env.REDIS_URL!);

// Only once no tus request is in flight: unlocking and saving the final offset both go through tusRedis.
export async function closeTusConnections() {
    await Promise.all([tusRedis.quit(), lockSubscriber.quit()]);
}

const datastore = new S3Store({
    partSize: 8 * 1024 * 1024,
    // Shared across replicas: the default in-memory cache is only cleared on the replica that
    // finished or removed an upload, so others kept stale entries (and never freed them).
    cache: new ExpiringRedisKvStore<MetadataValue>(tusRedis, 'tus:meta:', 7 * 24 * 60 * 60),
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

// Uploads by anonymous users (no email) expire; account holders' uploads don't.
const ANONYMOUS_UPLOAD_TTL_DAYS = Number(process.env.ANONYMOUS_UPLOAD_TTL_DAYS);
if (!Number.isFinite(ANONYMOUS_UPLOAD_TTL_DAYS) || ANONYMOUS_UPLOAD_TTL_DAYS <= 0) {
    throw new Error('ANONYMOUS_UPLOAD_TTL_DAYS must be a positive number of days');
}

async function expiryFor(userId: string | null): Promise<Date | null> {
    if (userId) {
        const [user] = await db.select({ email: users.email }).from(users).where(eq(users.id, userId));
        if (user?.email) return null;
    }
    return new Date(Date.now() + ANONYMOUS_UPLOAD_TTL_DAYS * 24 * 60 * 60 * 1000);
}

export const tusServer = new Server({
    path: '/upload',
    datastore,
    // Shared across replicas so a retried PATCH on another replica can't write alongside the original.
    locker: new RedisLocker(tusRedis, lockSubscriber),
    // uploads/<share id> — the share id doubles as files.id, the full id as storageKey.
    namingFunction: () => `${UPLOAD_KEY_PREFIX}${nanoid(10)}`,
    // Relative, so the client resolves it against the URL it posted to. Behind a proxy, the request's
    // host and proto are the internal ones (e.g. http://api:3000), not what the browser can reach.
    generateUrl: (_req, { path, id }) => `${path}/${toShareId(id)}`,
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
            expiresAt: await expiryFor(userId),
        });

        return {};
    },
    onUploadFinish: async (_req, upload) => {
        const fileId = toShareId(upload.id);
        await db.update(files).set({ fileStatus: 'uploaded', uploadedAt: new Date() }).where(eq(files.id, fileId));
        // Not rethrown: the upload itself is complete, and the client won't retry this hook anyway.
        // A failed enqueue (or a crash before it) is picked up by the worker's reconcile sweep.
        try {
            await fileProcessingQueue.add(PROCESS_UPLOAD_JOB, { fileId }, { jobId: processUploadJobId(fileId) });
        } catch (err) {
            console.error(`enqueue failed for file ${fileId}, leaving it to the reconcile sweep:`, err);
        }
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
