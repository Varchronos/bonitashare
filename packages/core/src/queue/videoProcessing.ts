import { Queue } from 'bullmq';
import type { Redis } from 'ioredis';

// Separate from file-processing so long transcodes never hold up thumbnails, and the two
// workers can be scaled (and sized) independently.
export const VIDEO_PROCESSING_QUEUE = 'video-processing';

export const TRANSCODE_HLS_JOB = 'transcode-hls';

export type TranscodeHlsJob = { fileId: string };
export type VideoProcessingJobData = TranscodeHlsJob;
export type VideoProcessingJobName = typeof TRANSCODE_HLS_JOB;

// BullMQ doesn't close a connection it was handed, so callers close the queue and the connection separately.
export const createVideoProcessingQueue = (connection: Redis) =>
    new Queue<VideoProcessingJobData, void, VideoProcessingJobName>(VIDEO_PROCESSING_QUEUE, {
        connection,
        defaultJobOptions: {
            attempts: 3,
            backoff: { type: 'exponential', delay: 2000 },
            // Same retention as file-processing, so a finished job's state outlives any sweep window.
            removeOnComplete: { age: 86_400 },
            removeOnFail: { age: 7 * 86_400 },
        },
    });

// Same reasoning as processUploadJobId: a stable id dedupes re-adds for the same file.
export const transcodeHlsJobId = (fileId: string) => `${TRANSCODE_HLS_JOB}-${fileId}`;
