import type { ApiResponse } from "@bonitashare/shared-types";
import type { FastifyPluginAsync } from "fastify";

const sessionRoutes: FastifyPluginAsync = async (fastify) => {
    fastify.get("/session", async (req): Promise<ApiResponse<{ userId: string | null }>> => {
        return { data: { userId: req.userId }, error: null };
    });
};

export default sessionRoutes;
