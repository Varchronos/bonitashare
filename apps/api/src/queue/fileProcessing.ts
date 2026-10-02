import { Queue } from 'bullmq';
import { redisConnection } from './connection.js';

export const FILE_PROCESSING_QUEUE = 'file-processing';

export type ProcessUploadJob = { fileId: string };

export const fileProcessingQueue = new Queue<ProcessUploadJob>(FILE_PROCESSING_QUEUE, {
    connection: redisConnection,
    defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
    },
});
