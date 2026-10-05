import { createFileProcessingQueue, createRedis } from '@bonitashare/core/queue';

export const redisConnection = createRedis(process.env.REDIS_URL!);

export const fileProcessingQueue = createFileProcessingQueue(redisConnection);
