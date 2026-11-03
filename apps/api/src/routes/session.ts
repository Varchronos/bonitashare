import type { ApiResponse } from "@bonitashare/shared-types";
import type { FastifyPluginAsync } from "fastify";
import { eq } from "drizzle-orm";
import { users } from "@bonitashare/core/db";
import { db } from "@/db/client.js";
import { endSession, findSession, isActive, issueSession } from "@/plugins/custom/handleSession.js";

const sessionRoutes: FastifyPluginAsync = async (fastify) => {
    // The only route that issues sessions:
    //   valid cookie   -> same session, nothing issued
    //   expired cookie -> new token, same user_id
    //   no/bad cookie  -> new anonymous user
    fastify.get("/session", async (req, rep): Promise<ApiResponse<{ userId: string }>> => {
        const session = await findSession(req);
        if (session && isActive(session)) {
            return { data: { userId: session.userId }, error: null };
        }

        const userId = await issueSession(req, rep, session);
        return { data: { userId }, error: null };
    });

    /*
     Logout Only for accounts: an anonymous user's files are reachable through this browser's session alone, so ending it would lose them for good. Works on an expired session too, so the cookie can always be cleared; with no session at all there's nothing to do.
    */
     fastify.delete("/session", async (req, rep): Promise<ApiResponse<null>> => {
        const session = await findSession(req);
        if (!session) return { data: null, error: null };

        const [user] = await db.select({ email: users.email }).from(users).where(eq(users.id, session.userId));
        if (!user?.email) {
            rep.code(409);
            return { data: null, error: { message: "Anonymous sessions can't log out", code: "ANONYMOUS_SESSION" } };
        }

        await endSession(req, rep, session);
        return { data: null, error: null };
    });
};

export default sessionRoutes;
