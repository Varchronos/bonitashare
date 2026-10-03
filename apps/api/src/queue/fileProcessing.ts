import { Queue } from 'bullmq';
import { redisConnection } from './connection.js';

export const FILE_PROCESSING_QUEUE = 'file-processing';

export const PROCESS_UPLOAD_JOB = 'process-upload';
export const RECONCILE_UPLOADS_JOB = 'reconcile-uploads';

export type ProcessUploadJob = { fileId: string };
// The reconcile job carries no data; it reads what to do from the files table.
export type FileProcessingJobData = ProcessUploadJob | Record<string, never>;
export type FileProcessingJobName = typeof PROCESS_UPLOAD_JOB | typeof RECONCILE_UPLOADS_JOB;

export const fileProcessingQueue = new Queue<FileProcessingJobData, void, FileProcessingJobName>(FILE_PROCESSING_QUEUE, {
    connection: redisConnection,
    defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
    },
});

// A stable jobId makes BullMQ ignore a duplicate add for the same file, which is what lets the
// reconcile sweep re-add freely. Prefixed because BullMQ rejects purely numeric custom ids,
// which a nanoid can (rarely) be.
export const processUploadJobId = (fileId: string) => `${PROCESS_UPLOAD_JOB}-${fileId}`;
