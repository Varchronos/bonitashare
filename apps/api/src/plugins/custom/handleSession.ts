import { db } from "@/db/client.js";
import { userSessions, users } from "@/db/schema.js";
import { eq } from "drizzle-orm";
import type { FastifyPluginAsync, FastifyReply, FastifyRequest, onRequestHookHandler } from "fastify";
import fp from "fastify-plugin";
import type { ApiFailure } from "@bonitashare/shared-types";
import { gen32Token, hashToken } from "@/utils/crypto.js";

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
    }
}

const SESSION_COOKIE = "session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
// The cookie must outlive the session it carries — otherwise the browser
// drops it the moment the session expires, and /session can never map the
// expired token back to its user_id to renew it. 400 days is the cap modern
// browsers enforce on cookie lifetime.
const COOKIE_MAX_AGE_S = 400 * 24 * 60 * 60;

type Session = typeof userSessions.$inferSelect;

// Looks up the session the request's cookie points at, expired or not.
// Returns null for a missing, tampered, or unknown token.
export async function findSession(req: FastifyRequest): Promise<Session | null> {
    const rawCookie = req.cookies[SESSION_COOKIE];
    if (!rawCookie) return null;

    const unsigned = req.unsignCookie(rawCookie);
    if (!unsigned.valid || !unsigned.value) return null;

    const [session] = await db.select().from(userSessions).where(eq(userSessions.tokenHash, hashToken(unsigned.value)));
    return session ?? null;
}

export function isActive(session: Session) {
    return session.expiresAt > new Date();
}

// Issues a fresh session token. With `existing`, it's a renewal: the old
// (expired) session row is replaced and the same user is kept. Without it,
// a new anonymous user is created. Only /session should call this.
export async function issueSession(req: FastifyRequest, rep: FastifyReply, existing: Session | null): Promise<string> {
    const rawToken = gen32Token();

    const userId = await db.transaction(async (tx) => {
        let userId: string;
        if (existing) {
            await tx.delete(userSessions).where(eq(userSessions.id, existing.id));
            userId = existing.userId;
        } else {
            const [user] = await tx.insert(users).values({}).returning();
            userId = user.id;
        }

        await tx.insert(userSessions).values({
            userId,
            tokenHash: hashToken(rawToken),
            userAgent: req.headers["user-agent"] ?? null,
            ipAddress: req.ip,
            expiresAt: new Date(Date.now() + SESSION_TTL_MS),
        });
        return userId;
    });

    rep.setCookie(SESSION_COOKIE, rawToken, {
        signed: true,
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: process.env.NODE_ENV === "production",
        maxAge: COOKIE_MAX_AGE_S,
        // Unset locally (localhost already shares cookies across ports).
        // In prod, set to the shared parent domain (e.g. ".example.com")
        // so both the web app's SSR server and the API receive it.
        domain: process.env.COOKIE_DOMAIN || undefined,
    });

    return userId;
}

const handleSession: FastifyPluginAsync = async (fastify) => {
    fastify.decorateRequest("userId", null);

    fastify.decorate("requireSession", async (req: FastifyRequest, rep: FastifyReply) => {
        const session = await findSession(req);
        if (session && isActive(session)) {
            req.userId = session.userId;
            return;
        }

        // SESSION_EXPIRED tells the client a GET /session will renew it
        // under the same user; UNAUTHENTICATED means there's nothing to renew.
        const body: ApiFailure = session
            ? { data: null, error: { message: "Session expired", code: "SESSION_EXPIRED" } }
            : { data: null, error: { message: "No valid session", code: "UNAUTHENTICATED" } };
        return rep.code(401).send(body);
    });

    fastify.decorate("optionalSession", async (req: FastifyRequest) => {
        const session = await findSession(req);
        if (session && isActive(session)) req.userId = session.userId;
    });
};

export default fp(handleSession);
