import { randomUUID } from 'node:crypto';
import type { Redis } from 'ioredis';
import { ERRORS, type Lock, type Locker, type RequestRelease } from '@tus/server';

const LOCK_PREFIX = 'tus:lock:';
const RELEASE_PREFIX = 'tus:lock-release:';

// Compare-and-act on the token so a replica never extends or deletes a lock it no longer owns.
const RENEW = `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('pexpire', KEYS[1], ARGV[2]) else return 0 end`;
const RELEASE = `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end`;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class RedisLocker implements Locker {
    // Locks held by this process, so a release request from any replica can cancel the holding request.
    readonly held = new Map<string, RequestRelease>();

    constructor(
        readonly redis: Redis,
        subscriber: Redis,
        readonly lockTtl = 30_000,
        readonly acquireTimeout = 30_000,
    ) {
        subscriber.psubscribe(`${RELEASE_PREFIX}*`).catch((err) => console.error('tus locker subscribe failed', err));
        subscriber.on('pmessage', (_pattern, channel) => {
            void this.held.get(channel.slice(RELEASE_PREFIX.length))?.();
        });
    }

    newLock(id: string): Lock {
        return new RedisLock(id, this);
    }
}

class RedisLock implements Lock {
    private readonly token = randomUUID();
    private readonly key: string;
    private renewTimer?: NodeJS.Timeout;
    private cancelReq?: RequestRelease;

    constructor(private readonly id: string, private readonly locker: RedisLocker) {
        this.key = LOCK_PREFIX + id;
    }

    async lock(signal: AbortSignal, cancelReq: RequestRelease): Promise<void> {
        const { redis, lockTtl, acquireTimeout } = this.locker;
        const deadline = Date.now() + acquireTimeout;

        while (!(await redis.set(this.key, this.token, 'PX', lockTtl, 'NX'))) {
            if (signal.aborted || Date.now() >= deadline) throw ERRORS.ERR_LOCK_TIMEOUT;
            // Ask whichever replica holds it to cancel its request; it unlocks within lockDrainTimeout.
            await redis.publish(RELEASE_PREFIX + this.id, '');
            await sleep(100);
        }

        this.cancelReq = cancelReq;
        this.locker.held.set(this.id, cancelReq);

        let lastRenewed = Date.now();
        this.renewTimer = setInterval(async () => {
            try {
                if ((await redis.eval(RENEW, 1, this.key, this.token, lockTtl)) === 1) {
                    lastRenewed = Date.now();
                    return;
                }
            } catch {
                // Transient Redis error: keep the lock until the TTL would have run out.
                if (Date.now() - lastRenewed < lockTtl) return;
            }
            // Lock lost (expired or taken over): stop writing.
            clearInterval(this.renewTimer);
            void cancelReq();
        }, lockTtl / 3);
        this.renewTimer.unref();
    }

    async unlock(): Promise<void> {
        clearInterval(this.renewTimer);
        if (this.locker.held.get(this.id) === this.cancelReq) this.locker.held.delete(this.id);
        await this.locker.redis.eval(RELEASE, 1, this.key, this.token);
    }
}
