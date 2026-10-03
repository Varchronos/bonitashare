import type { Redis } from 'ioredis';
import type { KvStore } from '@tus/server';

// Like @tus/utils' IoRedisKvStore, but entries expire. S3Store only clears an entry when an upload
// finishes or is removed, so abandoned uploads would otherwise leave keys in Redis forever.
// An expired entry just costs S3Store one re-read of the upload's .info object.
export class ExpiringRedisKvStore<T> implements KvStore<T> {
    constructor(
        private readonly redis: Redis,
        private readonly prefix: string,
        private readonly ttlSeconds: number,
    ) {}

    async get(key: string): Promise<T | undefined> {
        const value = await this.redis.get(this.prefix + key);
        return value ? (JSON.parse(value) as T) : undefined;
    }

    async set(key: string, value: T): Promise<void> {
        await this.redis.set(this.prefix + key, JSON.stringify(value), 'EX', this.ttlSeconds);
    }

    async delete(key: string): Promise<void> {
        await this.redis.del(this.prefix + key);
    }
}
