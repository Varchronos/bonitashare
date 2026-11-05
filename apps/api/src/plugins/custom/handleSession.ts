import { db } from "@/db/client.js";
import { userSessions, users } from "@bonitashare/core/db";
import { and, eq, isNotNull } from "drizzle-orm";
import type { FastifyPluginAsync, FastifyReply, FastifyRequest, onRequestHookHandler } from "fastify";
import fp from "fastify-plugin";
import type { ApiFailure } from "@bonitashare/shared-types";
import { gen32Token, hashToken } from "@/utils/crypto.js";
import { deviceTypeOf } from "@/utils/device.js";

declare module "fastify" {
    interface FastifyRequest {
        userId: string | null;
    }

    interface FastifyInstance {
        // Private routes: valid session or 401. Never issues one.
        requireSession: onRequestHookHandler;
        // Public routes that still care who's asking (e.g. owner-only files).
        // Sets userId when the session is valid, otherwise leaves it null.
        optionalSession: onRequestHookHandler;
        // Moderation routes: a valid session for a signed-in account with role 'admin', or 401/403.
        requireAdmin: onRequestHookHandler;
    }
}

const SESSION_COOKIE = "session";
// While an account is logged in, the anonymous session this browser had before, so logout can hand it
// back. Only the browser can hold it: the server keeps nothing but token hashes.
const ANON_COOKIE = "anon_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
// The cookie must outlive the session it carries — otherwise the browser
// drops it the moment the session expires, and /session can never map the
// expired token back to its user_id to renew it. 400 days is the cap modern
// browsers enforce on cookie lifetime.
const COOKIE_MAX_AGE_S = 400 * 24 * 60 * 60;

type Session = typeof userSessions.$inferSelect;

// The raw token in a signed cookie, or null when it's missing or tampered with.
function cookieToken(req: FastifyRequest, name: string): string | null {
    const rawCookie = req.cookies[name];
    if (!rawCookie) return null;

    const unsigned = req.unsignCookie(rawCookie);
    return unsigned.valid && unsigned.value ? unsigned.value : null;
}

async function sessionByToken(token: string): Promise<Session | null> {
    const [session] = await db.select().from(userSessions).where(eq(userSessions.tokenHash, hashToken(token)));
    return session ?? null;
}

// Looks up the session the request's cookie points at, expired or not.
// Returns null for a missing, tampered, or unknown token.
export async function findSession(req: FastifyRequest): Promise<Session | null> {
    const token = cookieToken(req, SESSION_COOKIE);
    return token ? sessionByToken(token) : null;
}

export function isActive(session: Session) {
    return session.expiresAt > new Date();
}

// Issues a fresh session token. With `existing`, the old session row is
// replaced and the same user is kept: /session uses that to renew an expired
// one, and signup to rotate the token once the account is verified. Without
// it, a new anonymous user is created, which only /session should do.
// With `forUserId`, the session belongs to that user instead (login), and
// `existing`, if any, is replaced; login passes null to keep the anonymous one
// for stashAnonymousSession.
export async function issueSession(
    req: FastifyRequest,
    rep: FastifyReply,
    existing: Session | null,
    forUserId?: string,
): Promise<string> {
    const rawToken = gen32Token();

    const userId = await db.transaction(async (tx) => {
        let userId: string;
        if (existing) await tx.delete(userSessions).where(eq(userSessions.id, existing.id));

        if (forUserId) {
            userId = forUserId;
        } else if (existing) {
            userId = existing.userId;
        } else {
            const [user] = await tx.insert(users).values({}).returning();
            userId = user.id;
        }

        await tx.insert(userSessions).values({
            userId,
            tokenHash: hashToken(rawToken),
            userAgent: req.headers["user-agent"] ?? null,
            deviceType: deviceTypeOf(req.headers["user-agent"]),
            ipAddress: req.ip,
            expiresAt: new Date(Date.now() + SESSION_TTL_MS),
        });
        return userId;
    });

    setTokenCookie(rep, SESSION_COOKIE, rawToken);

    return userId;
}

// At login: keeps the request's (anonymous) session token in ANON_COOKIE, for endSession to restore.
// Its row stays as it is, so the anonymous user's files come back with it.
export function stashAnonymousSession(req: FastifyRequest, rep: FastifyReply) {
    const token = cookieToken(req, SESSION_COOKIE);
    if (token) setTokenCookie(rep, ANON_COOKIE, token);
}

// Ends the request's session: its row goes, and the cookie is cleared with the same scope it was set
// with, or the browser keeps it. If login stashed an anonymous session that still exists, it becomes
// the browser's session again (expired is fine: /session renews it for the same user); otherwise the
// next GET /session starts a new anonymous user.
export async function endSession(req: FastifyRequest, rep: FastifyReply, session: Session) {
    await db.delete(userSessions).where(eq(userSessions.id, session.id));

    const anonToken = cookieToken(req, ANON_COOKIE);
    const anon = anonToken ? await sessionByToken(anonToken) : null;
    // Only ever back to an anonymous user, never into another account.
    const [anonUser] = anon ? await db.select({ email: users.email }).from(users).where(eq(users.id, anon.userId)) : [];

    if (anonToken && anonUser && !anonUser.email) setTokenCookie(rep, SESSION_COOKIE, anonToken);
    else rep.clearCookie(SESSION_COOKIE, cookieScope());
    rep.clearCookie(ANON_COOKIE, cookieScope());
}

function setTokenCookie(rep: FastifyReply, name: string, token: string) {
    rep.setCookie(name, token, { ...cookieScope(), signed: true, httpOnly: true, sameSite: "lax", maxAge: COOKIE_MAX_AGE_S });
}

function cookieScope() {
    return {
        path: "/",
        secure: process.env.NODE_ENV === "production",
        // Unset locally (localhost already shares cookies across ports).
        // In prod, set to the shared parent domain (e.g. ".example.com")
        // so both the web app's SSR server and the API receive it.
        domain: process.env.COOKIE_DOMAIN || undefined,
    };
}

const handleSession: FastifyPluginAsync = async (fastify) => {
    fastify.decorateRequest("userId", null);

    // Sets req.userId and returns null, or sends a 401 and returns the reply, which the hook must
    // return too: an async hook that sends without returning the reply lets the request carry on.
    async function checkSession(req: FastifyRequest, rep: FastifyReply) {
        const session = await findSession(req);
        if (session && isActive(session)) {
            req.userId = session.userId;
            return null;
        }

        // SESSION_EXPIRED tells the client a GET /session will renew it
        // under the same user; UNAUTHENTICATED means there's nothing to renew.
        const body: ApiFailure = session
            ? { data: null, error: { message: "Session expired", code: "SESSION_EXPIRED" } }
            : { data: null, error: { message: "No valid session", code: "UNAUTHENTICATED" } };
        return rep.code(401).send(body);
    }

    fastify.decorate("requireSession", async (req: FastifyRequest, rep: FastifyReply) => {
        const denied = await checkSession(req, rep);
        if (denied) return denied;
    });

    // The role is read on every request rather than kept in the session, so taking it away works at once.
    fastify.decorate("requireAdmin", async (req: FastifyRequest, rep: FastifyReply) => {
        const denied = await checkSession(req, rep);
        if (denied) return denied;

        const [admin] = await db
            .select({ id: users.id })
            .from(users)
            .where(and(eq(users.id, req.userId!), eq(users.role, "admin"), isNotNull(users.email)));
        if (!admin) {
            const body: ApiFailure = { data: null, error: { message: "Admins only", code: "FORBIDDEN" } };
            return rep.code(403).send(body);
        }
    });

    fastify.decorate("optionalSession", async (req: FastifyRequest) => {
        const session = await findSession(req);
        if (session && isActive(session)) req.userId = session.userId;
    });
};

export default fp(handleSession);
