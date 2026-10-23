import { createFileProcessingQueue, createRedis, createVideoProcessingQueue } from '@bonitashare/core/queue';

export const redisConnection = createRedis(process.env.REDIS_URL!);

export const fileProcessingQueue = createFileProcessingQueue(redisConnection);

// Only for restores, which re-queue a transcode that a delete cut short.
export const videoProcessingQueue = createVideoProcessingQueue(redisConnection);
