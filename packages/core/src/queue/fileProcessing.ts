import { Queue } from 'bullmq';
import type { Redis } from 'ioredis';

export const FILE_PROCESSING_QUEUE = 'file-processing';

export const PROCESS_UPLOAD_JOB = 'process-upload';
export const RECONCILE_UPLOADS_JOB = 'reconcile-uploads';
export const PURGE_DELETED_FILES_JOB = 'purge-deleted-files';

export type ProcessUploadJob = { fileId: string };
// The sweep jobs carry no data; they read what to do from the database.
export type FileProcessingJobData = ProcessUploadJob | Record<string, never>;
export type FileProcessingJobName = typeof PROCESS_UPLOAD_JOB | typeof RECONCILE_UPLOADS_JOB | typeof PURGE_DELETED_FILES_JOB;

// BullMQ doesn't close a connection it was handed, so callers close the queue and the connection separately.
export const createFileProcessingQueue = (connection: Redis) =>
    new Queue<FileProcessingJobData, void, FileProcessingJobName>(FILE_PROCESSING_QUEUE, {
        connection,
        defaultJobOptions: {
            attempts: 3,
            backoff: { type: 'exponential', delay: 2000 },
            // Kept a day so the reconcile sweep (which looks at rows pending past its 10-minute
            // window) can still read a finished job's state and repair a lost status write.
            removeOnComplete: { age: 86_400 },
            // Longer than completions: past the sweep's needs, failed jobs are kept for debugging.
            removeOnFail: { age: 7 * 86_400 },
        },
    });

// A stable jobId makes BullMQ ignore a duplicate add for the same file, which is what lets the
// reconcile sweep re-add freely. Prefixed because BullMQ rejects purely numeric custom ids,
// which a nanoid can (rarely) be.
export const processUploadJobId = (fileId: string) => `${PROCESS_UPLOAD_JOB}-${fileId}`;
