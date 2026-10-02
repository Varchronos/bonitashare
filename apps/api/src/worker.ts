import 'dotenv/config';
import { pipeline } from 'node:stream/promises';
import { UnrecoverableError, Worker } from 'bullmq';
import sharp from 'sharp';
import { eq } from 'drizzle-orm';
import { db } from '@/db/client.js';
import { files } from '@/db/schema.js';
import { storage, BUCKET } from '@/storage/client.js';
import { redisConnection } from '@/queue/connection.js';
import { FILE_PROCESSING_QUEUE, type ProcessUploadJob } from '@/queue/fileProcessing.js';

const THUMBNAILABLE_CONTENT_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']);

// Bigger images just go without a thumbnail the file itself is unaffected.
const MAX_THUMBNAIL_SOURCE_BYTES = 50 * 1024 * 1024;

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

    const thumbKey = `thumb/${fileId}.webp`;
    await storage.putObject(BUCKET, thumbKey, thumbnail, thumbnail.length, { 'Content-Type': 'image/webp' });
    await db.update(files).set({ thumbKey }).where(eq(files.id, fileId));
}

const worker = new Worker<ProcessUploadJob>(
    FILE_PROCESSING_QUEUE,
    async (job) => {
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
    },
    // Peak memory scales with this raise it deliberately, not by default.
    { connection: redisConnection, concurrency: 1 },
);

worker.on('failed', (job, err) => {
    console.error(`file-processing job ${job?.id} (file ${job?.data.fileId}) failed:`, err);
});

console.log('Worker listening on queue:', FILE_PROCESSING_QUEUE);
