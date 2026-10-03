import 'dotenv/config';
import { pipeline } from 'node:stream/promises';
import { UnrecoverableError, Worker, type Job } from 'bullmq';
import sharp from 'sharp';
import { and, eq, lt } from 'drizzle-orm';
import { db } from '@/db/client.js';
import { files } from '@/db/schema.js';
import { nanoid } from 'nanoid';
import { storage, BUCKET, THUMB_BUCKET } from '@/storage/client.js';
import { redisConnection } from '@/queue/connection.js';
import {
    FILE_PROCESSING_QUEUE,
    PROCESS_UPLOAD_JOB,
    RECONCILE_UPLOADS_JOB,
    fileProcessingQueue,
    processUploadJobId,
    type FileProcessingJobData,
    type FileProcessingJobName,
    type ProcessUploadJob,
} from '@/queue/fileProcessing.js';

const THUMBNAILABLE_CONTENT_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']);

// Bigger images just go without a thumbnail the file itself is unaffected.
const MAX_THUMBNAIL_SOURCE_BYTES = 50 * 1024 * 1024;

const RECONCILE_EVERY_MS = 5 * 60 * 1000;
// Well past a normal queue wait, so the sweep mostly finds jobs that were never enqueued.
// Re-adding one that is merely slow is harmless: the stable jobId makes it a no-op.
const RECONCILE_AFTER_MS = 10 * 60 * 1000;
const RECONCILE_BATCH_SIZE = 500;

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

async function processUpload(job: Job<ProcessUploadJob>) {
    const [file] = await db.select().from(files).where(eq(files.id, job.data.fileId));
    if (!file) return;

    // Video preview generation and AI summaries are handled separately, later.
    if (
        file.contentType &&
        THUMBNAILABLE_CONTENT_TYPES.has(file.contentType) &&
        file.sizeBytes <= MAX_THUMBNAIL_SOURCE_BYTES
    ) {
        await generateThumbnail(file.id, file.storageKey);
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

// Upserted by every worker on startup; BullMQ keeps a single schedule per id however many run.
await fileProcessingQueue.upsertJobScheduler(
    RECONCILE_UPLOADS_JOB,
    { every: RECONCILE_EVERY_MS },
    { name: RECONCILE_UPLOADS_JOB, data: {}, opts: { attempts: 1 } },
);

console.log('Worker listening on queue:', FILE_PROCESSING_QUEUE);
