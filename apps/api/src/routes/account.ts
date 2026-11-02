import { tierOf, type Account, type ApiResponse } from "@bonitashare/shared-types";
import type { FastifyPluginAsync } from "fastify";
import { eq } from "drizzle-orm";
import { users } from "@bonitashare/core/db";
import { db } from "@/db/client.js";

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
};

export default accountRoutes;
