import { db } from "@/db/client.js";
import { userSessions, users } from "@/db/schema.js";
import { eq } from "drizzle-orm";
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import { gen32Token, hashToken } from "@/utils/crypto.js";

declare module "fastify" {
    interface FastifyRequest {
        userId: string | null;
        // Set only when a new session is issued. reply.setCookie() defers
        // writing the header until Fastify's onSend hook runs, which routes
        // that call reply.hijack() (tus) skip entirely — they need to apply
        // this to reply.raw themselves instead.
        pendingSetCookie: string | null;
    }
}

const SESSION_COOKIE = "session";
const SESSION_TTL_MS = 365 * 24 * 60 * 60 * 1000; // 1 year in ms

const handleSession: FastifyPluginAsync = async (fastify) => {
    fastify.decorateRequest("userId", null);
    fastify.decorateRequest("pendingSetCookie", null);

    fastify.addHook("onRequest", async (req, rep) => {
        const rawCookie = req.cookies[SESSION_COOKIE];
        let rawToken: string | null = null;

        if (rawCookie) {
            const unsigned = req.unsignCookie(rawCookie);
            if (unsigned.valid && unsigned.value) {
                rawToken = unsigned.value;
            }
        }

        if (rawToken) {
            const tokenHash = hashToken(rawToken);
            const [session] = await db.select().from(userSessions).where(eq(userSessions.tokenHash, tokenHash));

            if (session && session.expiresAt > new Date()) {
                req.userId = session.userId;
                return;
            }

            if (session) {
                // stale/expired, so remove it.
                await db.delete(userSessions).where(eq(userSessions.id, session.id));
            }
        }

        await issueSession(req, rep);
    });
};

async function issueSession(req: FastifyRequest, rep: FastifyReply) {
    const rawToken = gen32Token();

    const user = await db.transaction(async (tx) => {
        const [user] = await tx.insert(users).values({}).returning();
        await tx.insert(userSessions).values({
            userId: user.id,
            tokenHash: hashToken(rawToken),
            userAgent: req.headers["user-agent"] ?? null,
            ipAddress: req.ip,
            expiresAt: new Date(Date.now() + SESSION_TTL_MS),
        });
        return user;
    });

    const cookieOptions = {
        secure: process.env.NODE_ENV === "production",
        maxAge: SESSION_TTL_MS / 1000,
        // Unset locally (localhost already shares cookies across ports).
        // In prod, set to the shared parent domain (e.g. ".example.com")
        // so both the web app's SSR server and the API receive it.
        domain: process.env.COOKIE_DOMAIN || undefined,
    };

    rep.setCookie(SESSION_COOKIE, rawToken, {
        signed: true,
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        ...cookieOptions,
    });

    req.pendingSetCookie = [
        `${SESSION_COOKIE}=${rep.signCookie(rawToken)}`,
        `Max-Age=${cookieOptions.maxAge}`,
        "Path=/",
        "HttpOnly",
        "SameSite=Lax",
        cookieOptions.secure ? "Secure" : null,
        cookieOptions.domain ? `Domain=${cookieOptions.domain}` : null,
    ].filter(Boolean).join("; ");

    req.userId = user.id;
}

export default fp(handleSession);
