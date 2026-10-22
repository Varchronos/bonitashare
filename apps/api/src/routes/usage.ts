import type { FastifyPluginAsync } from "fastify";
import type { ApiResponse, Usage } from "@bonitashare/shared-types";
import { resolveTier } from "@/upload/tier.js";
import { getUsage } from "@/upload/usage.js";

const usageRoutes: FastifyPluginAsync = async (fastify) => {
    fastify.addHook("onRequest", fastify.requireSession);

    // Served at /api/v1/usage: the quota meter on the upload page, and what it refetches after an upload ends.
    fastify.get("/usage", async (req): Promise<ApiResponse<Usage>> => {
        // requireSession has set it, or already replied 401.
        const userId = req.userId!;
        return { data: await getUsage(userId, await resolveTier(userId)), error: null };
    });
};

export default usageRoutes;
