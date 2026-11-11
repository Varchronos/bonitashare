import { ERRORS, EVENTS, Server, type Upload } from '@tus/server';
import { S3Store, type MetadataValue } from '@tus/s3-store';
import { nanoid } from 'nanoid';
import { eq, sql } from 'drizzle-orm';
import { db } from '@/db/client.js';
import { files, uploadUsage } from '@bonitashare/core/db';
import { TIER_LIMITS, quotaMessages, type Tier } from '@bonitashare/shared-types';
import { BUCKET, removeObjects } from '@bonitashare/core/storage';
import { PROCESS_UPLOAD_JOB, processUploadJobId } from '@bonitashare/core/queue';
import { fileProcessingQueue } from '@/queue/client.js';
import { storage } from '@/storage/client.js';
import { Redis } from 'ioredis';
import { LOCK_PREFIX, RedisLocker } from './redisLocker.js';
import { ExpiringRedisKvStore } from './redisKvStore.js';
import { getUsage } from './usage.js';

const endpoint = new URL(process.env.S3_ENDPOINT!);

// Both are stashed on the Node request by the upload route.
type TusRequest = { runtime?: { node?: { req: unknown } } };

function getUserId(req: TusRequest): string | null {
    return (req.runtime?.node?.req as { userId?: string | null } | undefined)?.userId ?? null;
}

function getTier(req: TusRequest): Tier {
    return (req.runtime?.node?.req as { tier?: Tier | null } | undefined)?.tier ?? 'anonymous';
}

// Read by onIncomingRequest before a DELETE: by POST_TERMINATE the store has already forgotten the upload.
function getTerminatedOffset(req: TusRequest): number | null {
    return (req.runtime?.node?.req as { terminatedOffset?: number } | undefined)?.terminatedOffset ?? null;
}

// Separate from the BullMQ connection: lock and metadata calls should fail fast, not retry forever.
// The subscriber needs its own connection because subscriber mode blocks other commands.
const tusRedis = new Redis(process.env.REDIS_URL!, { maxRetriesPerRequest: 2 });
const lockSubscriber = new Redis(process.env.REDIS_URL!);

// Only once no tus request is in flight: unlocking and saving the final offset both go through tusRedis.
export async function closeTusConnections() {
    await Promise.all([tusRedis.quit(), lockSubscriber.quit()]);
}

// Shared across replicas: the default in-memory cache is only cleared on the replica that
// finished or removed an upload, so others kept stale entries (and never freed them).
const metadataCache = new ExpiringRedisKvStore<MetadataValue>(tusRedis, 'tus:meta:', 7 * 24 * 60 * 60);

const datastore = new S3Store({
    partSize: 8 * 1024 * 1024,
    cache: metadataCache,
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

// Sent by the client as tus metadata, in seconds. Tiers without custom expiry always get their
// maximum; the others get what they asked for, capped at it, or the maximum when they don't ask.
const EXPIRES_IN_METADATA = 'expiresIn';

// Sent by the client as tus metadata: the file's last-modified time in ms, so a file added again
// to continue an interrupted upload can be told apart from another one with the same name and size.
const LAST_MODIFIED_METADATA = 'lastModified';

const isMissing = (err: unknown) =>
    typeof err === 'object' && err !== null && 'code' in err && (err.code === 'NotFound' || err.code === 'NoSuchKey');

// An unfinished upload as storage has it, or null if it's lost. R2 aborts multipart uploads left
// unfinished for 7 days but keeps their .info object, and S3Store reads a missing multipart upload as
// a completed one: such an upload looks fully received with nothing of it stored. So "complete" only
// counts if the finished object exists. No .info at all is lost too.
async function findUnfinishedUpload(storageKey: string): Promise<Upload | null> {
    let upload: Upload;
    try {
        upload = await datastore.getUpload(storageKey);
    } catch (err) {
        if (err === ERRORS.FILE_NOT_FOUND) return null;
        throw err;
    }
    if (upload.offset !== upload.size) return upload;
    try {
        await storage.statObject(BUCKET, storageKey);
        return upload;
    } catch (err) {
        if (isMissing(err)) return null;
        throw err;
    }
}

// Deletes a lost upload's leftovers and its row. Nothing it received survives, so it charges nothing.
async function discardLostUpload(storageKey: string) {
    await removeObjects(storage, BUCKET, [`${storageKey}.info`, `${storageKey}.part`]);
    await metadataCache.delete(storageKey);
    await releaseUpload(toShareId(storageKey), 0);
}

// For listing an unfinished upload: how much has arrived. Null when it shouldn't be listed: a request
// is writing to it right now (the tus lock is held), so it's still running in some tab or device, or
// it's lost, in which case it's discarded here. If storage can't be read, it's listed as nothing received.
export async function uploadProgress(storageKey: string) {
    const locked = await tusRedis.exists(LOCK_PREFIX + storageKey).then((n) => n === 1, () => false);
    if (locked) return null;
    try {
        const upload = await findUnfinishedUpload(storageKey);
        if (!upload) {
            await discardLostUpload(storageKey);
            return null;
        }
        return { offset: upload.offset, lastModified: Number(upload.metadata?.[LAST_MODIFIED_METADATA]) || null };
    } catch {
        return { offset: 0, lastModified: null };
    }
}

function expiryFor(tier: Tier, requested: string | null | undefined): Date | null {
    const { maxExpirySeconds, customExpiry } = TIER_LIMITS[tier];

    let seconds: number | null = maxExpirySeconds;
    if (customExpiry && requested != null) {
        const asked = Number(requested);
        if (!Number.isInteger(asked) || asked <= 0) {
            throw { status_code: 400, body: `Upload-Metadata '${EXPIRES_IN_METADATA}' must be a whole number of seconds\n` };
        }
        seconds = maxExpirySeconds === null ? asked : Math.min(asked, maxExpirySeconds);
    }
    return seconds === null ? null : new Date(Date.now() + seconds * 1000);
}

export const tusServer = new Server({
    // The full public path: the upload routes sit under autoload's /api/v1 prefix (see index.ts).
    path: '/api/v1/upload',
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
        if (!userId) {
            throw { status_code: 401, body: 'Session required\n' };
        }
        const tier = getTier(req);
        if (upload.size > TIER_LIMITS[tier].maxFileBytes) {
            // 413 rather than 429: the client retries 429s, and retrying can't make the file smaller.
            throw { status_code: 413, body: `${quotaMessages.fileTooLarge(tier)}\n` };
        }
        const expiresAt = expiryFor(tier, upload.metadata?.[EXPIRES_IN_METADATA]);
        const size = upload.size;

        await db.transaction(async (tx) => {
            // Serializes one user's creates, so parallel uploads can't each pass the check against the same usage.
            await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${userId}))`);

            // The full size counts from the start; a terminated upload is lowered to what it reached.
            const { weekly, storage } = await getUsage(userId, tier, tx);
            if (weekly.used + size > weekly.limit) {
                throw { status_code: 403, body: `${quotaMessages.weeklyFull(weekly.limit - weekly.used, weekly.limit)}\n` };
            }
            if (storage.limit !== null && storage.used + size > storage.limit) {
                throw { status_code: 403, body: `${quotaMessages.storageFull(storage.limit - storage.used, storage.limit)}\n` };
            }

            const fileId = toShareId(upload.id);
            await tx.insert(files).values({
                id: fileId,
                ownerId: userId,
                storageKey: upload.id,
                filename,
                contentType: upload.metadata?.filetype ?? null,
                sizeBytes: size,
                fileStatus: 'uploading',
                expiresAt,
            });
            await tx.insert(uploadUsage).values({ userId, fileId, bytesConsumed: size });
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

        const [file] = await db
            .select({ ownerId: files.ownerId, fileStatus: files.fileStatus })
            .from(files)
            .where(eq(files.id, toShareId(id)));
        if (!file) {
            throw { status_code: 404, body: 'Upload not found\n' };
        }
        const userId = getUserId(req);
        if (!userId || file.ownerId !== userId) {
            throw { status_code: 403, body: 'You are not the owner of this upload\n' };
        }

        // A lost upload (see findUnfinishedUpload) is deleted as soon as a client asks about it: HEAD is
        // a client checking where to continue from, DELETE a cancel. Either way it's gone afterwards, and
        // the 410 makes a resuming client start a new upload of the file. PATCH is left out: one always
        // follows a HEAD or a create, so it would only add a storage read to every chunk.
        if ((req.method === 'HEAD' || req.method === 'DELETE') && file.fileStatus === 'uploading') {
            if (!(await findUnfinishedUpload(id))) {
                await discardLostUpload(id);
                throw { status_code: 410, body: 'Upload expired before it finished\n' };
            }
        }

        if (req.method === 'DELETE') {
            // Taken before tus's lock, so a PATCH still in flight can land a few more bytes than this.
            const { offset } = await datastore.getUpload(id);
            Object.assign(req.runtime?.node?.req ?? {}, { terminatedOffset: offset });
        }
    },
});

// After a cancelled upload's storage is gone: drops its row and charges only what was actually uploaded.
// The usage row outlives the file and keeps counting for the week. Null offset leaves the charge alone.
async function releaseUpload(fileId: string, offset: number | null) {
    await db.transaction(async (tx) => {
        if (offset !== null) {
            await tx.update(uploadUsage).set({ bytesConsumed: offset }).where(eq(uploadUsage.fileId, fileId));
        }
        await tx.delete(files).where(eq(files.id, fileId));
    });
}

tusServer.on(EVENTS.POST_TERMINATE, async (req, _res, id) => {
    const fileId = toShareId(id);
    // An event listener: nothing awaits it, so a throw here would be an unhandled rejection.
    try {
        await releaseUpload(fileId, getTerminatedOffset(req));
    } catch (err) {
        console.error(`cleanup after terminating upload ${fileId} failed:`, err);
    }
})
