import 'dotenv/config';
import { pipeline } from 'node:stream/promises';
import { UnrecoverableError, Worker, type Job } from 'bullmq';
import sharp from 'sharp';
import { and, eq, lt, lte, sql } from 'drizzle-orm';
import { createDb, fileDeletions, fileVideos, files } from '@bonitashare/core/db';
import { nanoid } from 'nanoid';
import { BUCKET, HLS_BUCKET, THUMB_BUCKET, createStorage } from '@bonitashare/core/storage';
import { onShutdown } from '@bonitashare/core/shutdown';
import {
    FILE_PROCESSING_QUEUE,
    PROCESS_UPLOAD_JOB,
    PURGE_DELETED_FILES_JOB,
    RECONCILE_UPLOADS_JOB,
    TRANSCODE_HLS_JOB,
    createFileProcessingQueue,
    createRedis,
    createVideoProcessingQueue,
    processUploadJobId,
    transcodeHlsJobId,
    type FileProcessingJobData,
    type FileProcessingJobName,
    type ProcessUploadJob,
} from '@bonitashare/core/queue';

const { db, pool } = createDb(process.env.DATABASE_URL!);
const storage = createStorage();
const redisConnection = createRedis(process.env.REDIS_URL!);
// Used to enqueue the reconcile sweep's re-adds and to register its schedule.
const fileProcessingQueue = createFileProcessingQueue(redisConnection);
// Transcodes run in the video-worker; this worker only hands them off.
const videoProcessingQueue = createVideoProcessingQueue(redisConnection);

const THUMBNAILABLE_CONTENT_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']);

// Bigger images just go without a thumbnail the file itself is unaffected.
const MAX_THUMBNAIL_SOURCE_BYTES = 50 * 1024 * 1024;

const RECONCILE_EVERY_MS = 5 * 60 * 1000;
// Well past a normal queue wait, so the sweep mostly finds jobs that were never enqueued.
// Re-adding one that is merely slow is harmless: the stable jobId makes it a no-op.
const RECONCILE_AFTER_MS = 10 * 60 * 1000;
const RECONCILE_BATCH_SIZE = 500;

// Timing isn't promised to the user beyond "after the restore window", so this only bounds how long
// a deleted file's objects outlive it.
const PURGE_EVERY_MS = 15 * 60 * 1000;
// Each file is a few storage calls (one per thousand HLS segments), so a batch stays well inside a run.
const PURGE_BATCH_SIZE = 50;

// libvips caches decoded images for repeated operations; every job here reads a different file,
// so the cache only holds memory between jobs.
sharp.cache(false);

async function streamToBuffer(stream: AsyncIterable<unknown>): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    return Buffer.concat(chunks);
}

async function generateThumbnail(fileId: string, storageKey: string) {
    const original = await storage.getObject(BUCKET, storageKey);
    // Streamed straight into sharp so the compressed original is never held in memory.
    // sharp's default limitInputPixels (~268MP) still rejects decompression bombs.
    const resizer = sharp().resize(400, 400, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 80 });

    // pipeline() destroys every stream with the first error, so only the first one to fail says
    // where it came from. Listeners attached before pipeline() run ahead of that teardown.
    let failedFirst: 'download' | 'sharp' | undefined;
    original.once('error', () => (failedFirst ??= 'download'));
    resizer.once('error', () => (failedFirst ??= 'sharp'));

    let thumbnail!: Buffer;
    try {
        await pipeline(original, resizer, async (output) => {
            thumbnail = await streamToBuffer(output);
        });
    } catch (err) {
        // Bad or oversized image: the stored bytes won't change, so retrying is wasted work.
        // Download errors stay retryable.
        if (failedFirst === 'sharp') throw new UnrecoverableError((err as Error).message);
        throw err;
    }

    // Random rather than the share id: the thumb bucket is public, so the key must not be derivable
    // from a link to a private file. A fresh key per thumbnail also makes it safe to cache forever.
    const thumbKey = `${nanoid(21)}.webp`;
    await storage.putObject(THUMB_BUCKET, thumbKey, thumbnail, thumbnail.length, {
        'Content-Type': 'image/webp',
        'Cache-Control': 'public, max-age=31536000, immutable',
    });
    await db.update(files).set({ thumbKey }).where(eq(files.id, fileId));
}

// Row first, then the job: if the add is lost, the 'pending' row is what a sweep can find it by.
// Both steps are idempotent, so a retried processUpload repeats them safely.
async function enqueueTranscode(fileId: string) {
    // Chosen once, before the first attempt, so a retried transcode overwrites its own partial upload
    // instead of leaving copies under new prefixes. Random for the same reason as thumbKey: the HLS
    // bucket is public. onConflictDoNothing keeps the first prefix when this runs again.
    await db.insert(fileVideos).values({ fileId, hlsPrefix: nanoid(21) }).onConflictDoNothing();
    await videoProcessingQueue.add(TRANSCODE_HLS_JOB, { fileId }, { jobId: transcodeHlsJobId(fileId) });
}

async function processUpload(job: Job<ProcessUploadJob>) {
    const [file] = await db.select().from(files).where(eq(files.id, job.data.fileId));
    if (!file) return;

    // AI summaries are handled separately, later.
    if (
        file.contentType &&
        THUMBNAILABLE_CONTENT_TYPES.has(file.contentType) &&
        file.sizeBytes <= MAX_THUMBNAIL_SOURCE_BYTES
    ) {
        await generateThumbnail(file.id, file.storageKey);
    }

    // The video-worker probes the file itself, so anything claiming to be video is handed over;
    // its poster frame becomes the thumbnail there. Small ones too: they get a poster but skip the encode.
    if (file.contentType?.startsWith('video/')) {
        await enqueueTranscode(file.id);
    }

    // Part of the job, so a failed write retries it rather than leaving the row for the sweep forever.
    await db.update(files).set({ processingStatus: 'done', processingError: null }).where(eq(files.id, file.id));
}

// Catches uploads whose job never reached Redis: a failed enqueue, or a restart between the
// 'uploaded' write and the enqueue in onUploadFinish. Also repairs rows whose job did finish but
// whose status write was lost; re-adding those is a no-op (the jobId is taken), so without this
// they'd sit 'pending' and be swept forever.
async function reconcileUploads() {
    const stale = await db
        .select({ id: files.id })
        .from(files)
        .where(
            and(
                eq(files.fileStatus, 'uploaded'),
                eq(files.processingStatus, 'pending'),
                lt(files.uploadedAt, new Date(Date.now() - RECONCILE_AFTER_MS)),
            ),
        )
        .limit(RECONCILE_BATCH_SIZE);
    if (stale.length === 0) return;

    const toEnqueue: string[] = [];
    let repaired = 0;
    for (const { id } of stale) {
        const job = await fileProcessingQueue.getJob(processUploadJobId(id));
        if (!job) {
            toEnqueue.push(id);
            continue;
        }
        const state = await job.getState();
        if (state === 'completed') {
            await markProcessed(id, { processingStatus: 'done', processingError: null });
            repaired++;
        } else if (state === 'failed') {
            await markProcessed(id, { processingStatus: 'failed', processingError: job.failedReason ?? null });
            repaired++;
        }
        // waiting / active / delayed / prioritized: still in flight, leave it to the job.
    }

    if (toEnqueue.length > 0) {
        await fileProcessingQueue.addBulk(
            toEnqueue.map((id) => ({
                name: PROCESS_UPLOAD_JOB,
                data: { fileId: id },
                opts: { jobId: processUploadJobId(id) },
            })),
        );
    }
    console.log(`reconcile: ${stale.length} stale, ${toEnqueue.length} re-enqueued, ${repaired} repaired from job state`);
}

async function removeObjects(bucket: string, keys: string[]) {
    if (keys.length === 0) return;
    // Per-key failures come back in the response rather than as a throw.
    const failed = (await storage.removeObjects(bucket, keys)).filter((r) => r?.Error);
    if (failed.length > 0) {
        throw new Error(`could not remove ${failed.length} objects from ${bucket}: ${failed[0]!.Error!.Code} ${failed[0]!.Error!.Message}`);
    }
}

async function listKeys(bucket: string, prefix: string): Promise<string[]> {
    const keys: string[] = [];
    for await (const item of storage.listObjectsV2(bucket, prefix, true)) {
        if (item.name) keys.push(item.name);
    }
    return keys;
}

// Hard-deletes one soft-deleted file: its original, thumbnail and HLS output, then its rows. Inside one
// transaction that holds the file_deletions row, so a restore that got in first leaves nothing to find,
// and one that comes after waits and then finds the window closed. A failed storage call rolls back and
// the next sweep tries again; objects already removed are no-ops then.
async function purgeFile(fileId: string) {
    await db.transaction(async (tx) => {
        const [due] = await tx
            .select({
                storageKey: files.storageKey,
                thumbKey: files.thumbKey,
                hlsPrefix: fileVideos.hlsPrefix,
            })
            .from(fileDeletions)
            .innerJoin(files, eq(files.id, fileDeletions.fileId))
            .leftJoin(fileVideos, eq(fileVideos.fileId, fileDeletions.fileId))
            .where(and(eq(fileDeletions.fileId, fileId), lte(fileDeletions.purgeAfter, sql`now()`)))
            .for('update', { of: fileDeletions });
        if (!due) return;

        // tus's S3Store keeps a `<key>.info` metadata object next to every upload, finished ones included.
        await removeObjects(BUCKET, [due.storageKey, `${due.storageKey}.info`]);
        if (due.thumbKey) await removeObjects(THUMB_BUCKET, [due.thumbKey]);
        // The trailing slash keeps one prefix from matching another that starts with it.
        if (due.hlsPrefix) await removeObjects(HLS_BUCKET, await listKeys(HLS_BUCKET, `${due.hlsPrefix}/`));

        // Cascades to file_deletions, file_videos and album links; upload_usage keeps its row for the weekly quota.
        await tx.delete(files).where(eq(files.id, fileId));
    });
}

// Objects a worker writes after its file was purged (a thumbnail finishing at that moment) aren't
// tracked anywhere; they're left to a future bucket lifecycle rule.
async function purgeDeletedFiles() {
    const due = await db
        .select({ fileId: fileDeletions.fileId })
        .from(fileDeletions)
        .where(lte(fileDeletions.purgeAfter, sql`now()`))
        .limit(PURGE_BATCH_SIZE);
    if (due.length === 0) return;

    let purged = 0;
    for (const { fileId } of due) {
        try {
            await purgeFile(fileId);
            purged++;
        } catch (err) {
            // One file's storage trouble shouldn't hold up the rest; it stays due for the next sweep.
            console.error(`purge: file ${fileId} failed, retrying next sweep:`, err);
        }
    }
    console.log(`purge: ${purged} of ${due.length} deleted files purged`);
}

// Only moves a row out of 'pending', so a sweep racing a job that just finished can't overwrite its result.
async function markProcessed(
    fileId: string,
    result: { processingStatus: 'done' | 'failed'; processingError: string | null },
) {
    await db
        .update(files)
        .set(result)
        .where(and(eq(files.id, fileId), eq(files.processingStatus, 'pending')));
}

const worker = new Worker<FileProcessingJobData, void, FileProcessingJobName>(
    FILE_PROCESSING_QUEUE,
    async (job) => {
        if (job.name === RECONCILE_UPLOADS_JOB) return reconcileUploads();
        if (job.name === PURGE_DELETED_FILES_JOB) return purgeDeletedFiles();
        return processUpload(job as Job<ProcessUploadJob>);
    },
    // Peak memory scales with this raise it deliberately, not by default.
    { connection: redisConnection, concurrency: 1 },
);

worker.on('failed', (job, err) => {
    if (job?.name !== PROCESS_UPLOAD_JOB) {
        console.error(`file-processing job ${job?.id} failed:`, err);
        return;
    }
    const { fileId } = job.data as ProcessUploadJob;
    console.error(`file-processing job ${job.id} (file ${fileId}) failed:`, err);

    // Only once BullMQ has given up; until then the row stays 'pending' and the job retries itself.
    const exhausted = err.name === 'UnrecoverableError' || job.attemptsMade >= (job.opts.attempts ?? 1);
    if (!exhausted) return;
    // If this write is lost, the reconcile sweep repairs the row from the job's failed state.
    markProcessed(fileId, { processingStatus: 'failed', processingError: err.message })
        .catch((dbErr) => console.error(`could not mark file ${fileId} as failed:`, dbErr));
});

// Must stay under the service's stop_grace_period in docker compose, or Docker SIGKILLs first.
const SHUTDOWN_DEADLINE_MS = 28_000;

onShutdown('worker', SHUTDOWN_DEADLINE_MS, async () => {
    // Stops taking jobs and waits for the active one. Waiting jobs stay in Redis for the next start;
    // a job killed mid-run would instead count as stalled, and a second stall fails it outright.
    await worker.close();
    // BullMQ doesn't close a connection it was handed, so the queue and its connection close separately.
    await fileProcessingQueue.close();
    await videoProcessingQueue.close();
    await redisConnection.quit();
    await pool.end();
});

// Upserted by every worker on startup; BullMQ keeps a single schedule per id however many run.
await fileProcessingQueue.upsertJobScheduler(
    RECONCILE_UPLOADS_JOB,
    { every: RECONCILE_EVERY_MS },
    // Nothing reads a finished sweep back, so completions go immediately; a few failures stay for debugging.
    { name: RECONCILE_UPLOADS_JOB, data: {}, opts: { attempts: 1, removeOnComplete: true, removeOnFail: { count: 50 } } },
);

await fileProcessingQueue.upsertJobScheduler(
    PURGE_DELETED_FILES_JOB,
    { every: PURGE_EVERY_MS },
    { name: PURGE_DELETED_FILES_JOB, data: {}, opts: { attempts: 1, removeOnComplete: true, removeOnFail: { count: 50 } } },
);

console.log('Worker listening on queue:', FILE_PROCESSING_QUEUE);
