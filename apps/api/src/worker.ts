import 'dotenv/config';
import { Worker } from 'bullmq';
import sharp from 'sharp';
import { eq } from 'drizzle-orm';
import { db } from '@/db/client.js';
import { files } from '@/db/schema.js';
import { storage, BUCKET } from '@/storage/client.js';
import { redisConnection } from '@/queue/connection.js';
import { FILE_PROCESSING_QUEUE, type ProcessUploadJob } from '@/queue/fileProcessing.js';

const THUMBNAILABLE_CONTENT_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']);

async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    return Buffer.concat(chunks);
}

async function generateThumbnail(fileId: string, storageKey: string) {
    const original = await storage.getObject(BUCKET, storageKey);
    const buffer = await streamToBuffer(original);
    const thumbnail = await sharp(buffer).resize(400, 400, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 80 }).toBuffer();

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
        if (file.contentType && THUMBNAILABLE_CONTENT_TYPES.has(file.contentType)) {
            await generateThumbnail(file.id, file.storageKey);
        }
    },
    { connection: redisConnection },
);

worker.on('failed', (job, err) => {
    console.error(`file-processing job ${job?.id} (file ${job?.data.fileId}) failed:`, err);
});

console.log('Worker listening on queue:', FILE_PROCESSING_QUEUE);
