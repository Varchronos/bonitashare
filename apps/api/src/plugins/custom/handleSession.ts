import { db } from "@/db/client.js";
import { userSessions, users } from "@/db/schema.js";
import { eq } from "drizzle-orm";
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import { gen32Token, hashToken } from "@/utils/crypto.js";

declare module "fastify" {
    interface FastifyRequest {
        userId: string | null;
    }
}

const SESSION_COOKIE = "session";
const SESSION_TTL_MS = 365 * 24 * 60 * 60 * 1000; // 1 year in ms

const handleSession: FastifyPluginAsync = async (fastify) => {
    fastify.decorateRequest("userId", null);

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

    rep.setCookie(SESSION_COOKIE, rawToken, {
        signed: true,
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: SESSION_TTL_MS / 1000,
        path: "/",
    });

    req.userId = user.id;
}

export default fp(handleSession);
