import { Redis } from 'ioredis';

// BullMQ requires this exact setting on the connection it's given.
export const createRedis = (url: string) =>
    new Redis(url, {
        maxRetriesPerRequest: null,
    });
