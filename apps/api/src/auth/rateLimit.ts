import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { Redis } from "ioredis";
import type { ApiFailure } from "@bonitashare/shared-types";

// Its own connection, failing fast: the BullMQ one retries forever while Redis is down, which would
// hang every auth request. If Redis is unreachable the limits are skipped rather than blocking sign-in.
export const rateLimitRedis = new Redis(process.env.REDIS_URL!, { maxRetriesPerRequest: 1 });

type Limiter = ReturnType<FastifyInstance["createRateLimit"]>;
type EmailOf = (req: FastifyRequest) => string;

// Login: after this many wrong passwords for one email inside the window, that email is locked out.
const LOGIN_MAX_FAILURES = 5;
const LOGIN_FAILURE_WINDOW_MS = 15 * 60 * 1000;
// The first lockout; each further failure doubles it, up to the cap.
const LOGIN_LOCK_BASE_MS = 15 * 60 * 1000;
const LOGIN_LOCK_MAX_MS = 60 * 60 * 1000;

// Counts a failure; at the limit, sets the lock key for a time that doubles with every failure past it.
// The count outlives the lock by one window, so a failure right after a lockout ends locks for longer.
const RECORD_LOGIN_FAILURE = `
local n = redis.call('INCR', KEYS[1])
local max = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
if n < max then
  if n == 1 then redis.call('PEXPIRE', KEYS[1], window) end
  return 0
end
local lock = math.floor(math.min(tonumber(ARGV[3]) * 2 ^ (n - max), tonumber(ARGV[4])))
redis.call('SET', KEYS[2], 1, 'PX', lock)
redis.call('PEXPIRE', KEYS[1], lock + window)
return lock
`;

// Every limit on the /auth routes. IP limits count every request; the per-address budgets count only
// codes actually sent, and signup and resend draw on the same ones.
export function createAuthLimits(fastify: FastifyInstance, emailOf: EmailOf) {
    const perIp = (name: string, max: number, timeWindow: string) =>
        fastify.createRateLimit({ max, timeWindow, keyGenerator: (req) => `auth:${name}:ip:${req.ip}` });
    const perEmail = (name: string, max: number, timeWindow: string) =>
        fastify.createRateLimit({ max, timeWindow, keyGenerator: (req) => `auth:${name}:email:${emailOf(req)}` });

    const sendBudget = [perEmail("send-hour", 3, "1 hour"), perEmail("send-day", 10, "1 day")];

    return {
        // onRequest hooks, so a blocked request is turned away before its body is even parsed. The signup
        // and verify ones are loose on purpose: mobile carriers put many people behind one address (CGNAT),
        // and Turnstile plus the per-address budgets below are what actually hold back abuse.
        login: limitHook(perIp("login-minute", 10, "1 minute"), perIp("login-hour", 100, "1 hour")),
        signupSend: limitHook(perIp("signup-send", 25, "1 hour")),
        verify: limitHook(perIp("verify", 60, "10 minutes")),

        // Seconds until another code may go to this address, or null if it may now. Checked before any
        // work is done, and only spent (spendSend) once the code is really on its way.
        async sendBlocked(req: FastifyRequest): Promise<number | null> {
            let wait: number | null = null;
            for (const limiter of sendBudget) {
                const r = await limiter(req, { increment: false });
                if (!r.isAllowed && r.remaining === 0 && r.ttlInSeconds > 0) wait = Math.max(wait ?? 0, r.ttlInSeconds);
            }
            return wait;
        },
        async spendSend(req: FastifyRequest) {
            for (const limiter of sendBudget) await limiter(req);
        },
    };
}

// Runs each limiter in turn and answers 429 at the first one that's used up.
function limitHook(...limiters: Limiter[]) {
    return async (req: FastifyRequest, reply: FastifyReply) => {
        for (const limiter of limiters) {
            const r = await limiter(req);
            if (!r.isAllowed && r.isExceeded) return reply.send(tooManyRequests(reply, r.ttlInSeconds));
        }
    };
}

// Seconds this email is locked out of login for, or null if it isn't.
export async function loginLockedFor(email: string, log: FastifyRequest["log"]): Promise<number | null> {
    try {
        const ms = await rateLimitRedis.pttl(lockKey(email));
        return ms > 0 ? Math.ceil(ms / 1000) : null;
    } catch (err) {
        log.warn({ err }, "login lockout check skipped");
        return null;
    }
}

// Counts a wrong password for this email (whether or not an account has it, so the lockout says
// nothing about who's registered). Returns the seconds of the lockout it started, or null.
export async function recordLoginFailure(email: string, log: FastifyRequest["log"]): Promise<number | null> {
    try {
        const ms = (await rateLimitRedis.eval(
            RECORD_LOGIN_FAILURE, 2, failKey(email), lockKey(email),
            LOGIN_MAX_FAILURES, LOGIN_FAILURE_WINDOW_MS, LOGIN_LOCK_BASE_MS, LOGIN_LOCK_MAX_MS,
        )) as number;
        return ms > 0 ? Math.ceil(ms / 1000) : null;
    } catch (err) {
        log.warn({ err }, "login failure not recorded");
        return null;
    }
}

export async function clearLoginFailures(email: string, log: FastifyRequest["log"]) {
    await rateLimitRedis.del(failKey(email), lockKey(email)).catch((err) => log.warn({ err }, "login failures not cleared"));
}

const failKey = (email: string) => `auth:login-fail:${email}`;
const lockKey = (email: string) => `auth:login-lock:${email}`;

// 429 with Retry-After, in the usual ApiResponse shape so the forms show the message as they do any other.
export function tooManyRequests(reply: FastifyReply, retryAfterSeconds: number): ApiFailure {
    const seconds = Math.max(1, retryAfterSeconds);
    reply.code(429).header("retry-after", String(seconds));
    return { data: null, error: { code: "RATE_LIMITED", message: `Too many attempts. Try again in ${formatWait(seconds)}.` } };
}

function formatWait(seconds: number) {
    if (seconds < 60) return seconds === 1 ? "1 second" : `${seconds} seconds`;
    const minutes = Math.ceil(seconds / 60);
    if (minutes < 60) return minutes === 1 ? "1 minute" : `${minutes} minutes`;
    const hours = Math.ceil(minutes / 60);
    return hours === 1 ? "1 hour" : `${hours} hours`;
}
