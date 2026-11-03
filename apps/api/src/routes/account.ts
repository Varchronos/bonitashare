import { tierOf, type Account, type ApiResponse } from "@bonitashare/shared-types";
import type { FastifyPluginAsync } from "fastify";
import { eq, sql } from "drizzle-orm";
import { albums, fileDeletions, files, users } from "@bonitashare/core/db";
import { PURGE_DELETED_FILES_JOB } from "@bonitashare/core/queue";
import { db } from "@/db/client.js";
import { fileProcessingQueue } from "@/queue/client.js";
import { endSession, findSession } from "@/plugins/custom/handleSession.js";
import { PASSWORD_MAX_LENGTH, verifyPassword } from "@/auth/password.js";
import { clearLoginFailures, loginLockedFor, recordLoginFailure, tooManyRequests } from "@/auth/rateLimit.js";

const accountRoutes: FastifyPluginAsync = async (fastify) => {
    fastify.addHook("onRequest", fastify.requireSession);

    // Served at /api/v1/account: who this browser is. Anonymous users get an answer too (email null),
    // so pages can tell "not signed up" apart from "no session".
    fastify.get("/account", async (req, reply): Promise<ApiResponse<Account>> => {
        const userId = req.userId!;
        const [user] = await db
            .select({ email: users.email, displayName: users.displayName, plan: users.plan, planExpiresAt: users.planExpiresAt })
            .from(users)
            .where(eq(users.id, userId));
        if (!user) {
            reply.code(401);
            return { data: null, error: { message: "No valid session", code: "UNAUTHENTICATED" } };
        }

        return { data: { userId, email: user.email, displayName: user.displayName, tier: tierOf(user) }, error: null };
    });

    // Served at /api/v1/account (beta): deletes the account for good, right away. Takes the password
    // again, since nothing brings it back.
    //
    // The user row goes in the transaction, and with it its sessions, visits, OTPs and usage. Every file
    // they own is handed to the worker's purge sweep, due now, trash included. That way R2 objects
    // (original, thumbnail, HLS) are removed by the same code, with the same retries, as a normal delete,
    // and the links 404 from this moment. The purge is started at once rather than at the next sweep.
    //
    // Later scope: a 30-day window in which the account and its files 404, then the worker deletes them
    // unless the user logs back in.
    fastify.delete<{ Body: { password?: unknown } }>("/account", async (req, reply): Promise<ApiResponse<null>> => {
        const userId = req.userId!;
        const password = req.body?.password;

        const [user] = await db.select({ email: users.email, passwordHash: users.passwordHash }).from(users).where(eq(users.id, userId));
        if (!user?.email || !user.passwordHash) {
            reply.code(409);
            return { data: null, error: { message: "Only accounts can be deleted", code: "ANONYMOUS_SESSION" } };
        }

        // Shares login's failure count and lockout, so this isn't a second way to guess the password.
        const email = user.email.toLowerCase();
        const lockedFor = await loginLockedFor(email, req.log);
        if (lockedFor) return tooManyRequests(reply, lockedFor);
        const ok =
            typeof password === "string" && password.length > 0 && password.length <= PASSWORD_MAX_LENGTH
                ? await verifyPassword(user.passwordHash, password)
                : false;
        if (!ok) {
            const lockout = await recordLoginFailure(email, req.log);
            if (lockout) return tooManyRequests(reply, lockout);
            reply.code(401);
            return { data: null, error: { message: "That password isn't right", code: "INVALID_PASSWORD" } };
        }

        const session = await findSession(req);

        const purgeCount = await db.transaction(async (tx) => {
            // Due now. A file already in the trash has its restore window closed instead.
            const due = await tx
                .insert(fileDeletions)
                .select(
                    tx
                        .select({ fileId: files.id, deletedAt: sql`now()`.as("deleted_at"), purgeAfter: sql`now()`.as("purge_after") })
                        .from(files)
                        .where(eq(files.ownerId, userId)),
                )
                .onConflictDoUpdate({ target: fileDeletions.fileId, set: { purgeAfter: sql`now()` } })
                .returning({ fileId: fileDeletions.fileId });

            // Album links cascade. Albums would otherwise outlive the user with no owner.
            await tx.delete(albums).where(eq(albums.ownerId, userId));
            // Files keep their rows (owner set null) until the sweep purges them.
            await tx.delete(users).where(eq(users.id, userId));
            return due.length;
        });

        req.log.info({ userId, files: purgeCount }, "account deleted");
        // As after a login: the password was right, so earlier misses on the delete form don't follow a
        // re-signup with this email into its first logins.
        await clearLoginFailures(email, req.log);

        // If this fails, the scheduled sweep gets to them anyway, just later.
        if (purgeCount > 0) {
            await fileProcessingQueue
                .add(PURGE_DELETED_FILES_JOB, {}, { attempts: 1, removeOnComplete: true, removeOnFail: { count: 50 } })
                .catch((err) => req.log.error({ err }, "could not start the purge; the next sweep will run it"));
        }

        // The session row went with the user. This clears the cookie, or puts back the anonymous session
        // this browser had before logging in, as logout does.
        if (session) await endSession(req, reply, session);
        return { data: null, error: null };
    });
};

export default accountRoutes;
