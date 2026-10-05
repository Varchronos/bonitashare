import 'dotenv/config';
import { execFile } from 'node:child_process';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { UnrecoverableError, Worker, type Job } from 'bullmq';
import { eq } from 'drizzle-orm';
import { createDb, fileVideos, files } from '@bonitashare/core/db';
import { BUCKET, createStorage } from '@bonitashare/core/storage';
import {
    VIDEO_PROCESSING_QUEUE,
    createRedis,
    type TranscodeHlsJob,
    type VideoProcessingJobData,
    type VideoProcessingJobName,
} from '@bonitashare/core/queue';
import { onShutdown } from '@bonitashare/core/shutdown';

const execFileAsync = promisify(execFile);

const { db, pool } = createDb(process.env.DATABASE_URL!);
const storage = createStorage();
const redisConnection = createRedis(process.env.REDIS_URL!);

// Fail at startup rather than on the first job if the image was built without ffmpeg.
const { stdout } = await execFileAsync('ffmpeg', ['-version']);
console.log(stdout.split('\n')[0]);

const WORKDIR_PREFIX = 'transcode-';

// A job killed mid-run (SIGKILL, OOM) never reaches its finally, so its source and renditions stay on
// disk. Concurrency is 1 and tmpdir is this container's own, so nothing else can be using these yet.
for (const entry of await readdir(tmpdir())) {
    if (entry.startsWith(WORKDIR_PREFIX)) await rm(path.join(tmpdir(), entry), { recursive: true, force: true });
}

async function downloadSource(storageKey: string, dest: string) {
    try {
        // To disk rather than piped into ffmpeg: phone MP4s often put the moov atom at the end,
        // which ffmpeg can only reach on seekable input.
        await storage.fGetObject(BUCKET, storageKey, dest);
    } catch (err) {
        // The original is gone, so no retry can bring it back. Anything else (network, MinIO) retries.
        // fGetObject stats first, and a HEAD 404 has no body, so minio reports it as NotFound, not NoSuchKey.
        const code = (err as { code?: string }).code;
        if (code === 'NotFound' || code === 'NoSuchKey') throw new UnrecoverableError(`original missing: ${storageKey}`);
        throw err;
    }
}

async function transcodeHls(job: Job<TranscodeHlsJob>) {
    const { fileId } = job.data;
    const [video] = await db
        .select({ status: fileVideos.status, hlsPrefix: fileVideos.hlsPrefix, storageKey: files.storageKey })
        .from(fileVideos)
        .innerJoin(files, eq(files.id, fileVideos.fileId))
        .where(eq(fileVideos.fileId, fileId));
    // Deleted or expired since enqueue (the cascade took the video row too), or a duplicate run of a
    // job that already finished: either way there's nothing to do.
    if (!video || video.status === 'done') return;

    // Unique per run, so a leftover from an earlier attempt can't be mistaken for this one's output.
    const workdir = await mkdtemp(path.join(tmpdir(), `${WORKDIR_PREFIX}${fileId}-`));
    try {
        const sourcePath = path.join(workdir, 'source');
        await downloadSource(video.storageKey, sourcePath);

        // TODO: probe, transcode to HLS renditions, upload under video.hlsPrefix, record on file_videos.
        throw new Error(`transcode-hls not implemented past download (file ${fileId})`);
    } finally {
        await rm(workdir, { recursive: true, force: true });
    }
}

const worker = new Worker<VideoProcessingJobData, void, VideoProcessingJobName>(
    VIDEO_PROCESSING_QUEUE,
    async (job) => transcodeHls(job),
    // A transcode uses every core ffmpeg is given; scale with replicas, not concurrency.
    { connection: redisConnection, concurrency: 1 },
);

worker.on('failed', (job, err) => {
    console.error(`video-processing job ${job?.id} failed:`, err);
});

// Must stay under the service's stop_grace_period in docker compose, or Docker SIGKILLs first.
// TODO before transcodes ship: a transcode outlasts this, so a deploy kills the active job and BullMQ
// restarts it as stalled; with the default maxStalledCount of 1 a second stall fails it. Either give this
// service a much longer grace period and deadline, or raise maxStalledCount on the Worker.
const SHUTDOWN_DEADLINE_MS = 28_000;

onShutdown('video-worker', SHUTDOWN_DEADLINE_MS, async () => {
    // Stops taking jobs and waits for the active one, up to the deadline.
    await worker.close();
    await redisConnection.quit();
    await pool.end();
});

console.log('Video worker listening on queue:', VIDEO_PROCESSING_QUEUE);
