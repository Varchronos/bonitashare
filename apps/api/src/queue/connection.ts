import { Redis } from 'ioredis';

// BullMQ requires this exact setting on the connection it's given.
export const redisConnection = new Redis(process.env.REDIS_URL!, {
    maxRetriesPerRequest: null,
});
