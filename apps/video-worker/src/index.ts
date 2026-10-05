import 'dotenv/config';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Worker, type Job } from 'bullmq';
import { createDb } from '@bonitashare/core/db';
import { createStorage } from '@bonitashare/core/storage';
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

async function transcodeHls(job: Job<TranscodeHlsJob>) {
    // TODO: download the original, transcode to HLS renditions with ffmpeg, upload the playlist and
    // segments, and record them on the file row.
    throw new Error(`transcode-hls not implemented yet (file ${job.data.fileId})`);
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
