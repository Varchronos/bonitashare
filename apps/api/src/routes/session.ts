import type { ApiResponse } from "@bonitashare/shared-types";
import type { FastifyPluginAsync } from "fastify";
import { findSession, isActive, issueSession } from "@/plugins/custom/handleSession.js";

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
};

export default sessionRoutes;
