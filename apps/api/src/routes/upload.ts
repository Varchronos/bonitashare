import type { FastifyPluginAsync, FastifyReply, FastifyRequest, HTTPMethods } from 'fastify';
import { tusServer } from '@/upload/tusServer.js';

const TUS_METHODS: HTTPMethods[] = ['GET', 'POST', 'PATCH', 'HEAD', 'DELETE', 'OPTIONS'];

async function handleTus(req: FastifyRequest, reply: FastifyReply) {
    // Stashed here so onUploadCreate can attribute the upload to a user —
    // tus only ever sees the raw Node req, not the Fastify request.
    (req.raw as unknown as { userId: string | null }).userId = req.userId;

    reply.hijack();
    try {
        await tusServer.handle(req.raw, reply.raw);
    } catch (err) {
        req.log.error({ err }, 'tus handle failed');
    }
}

const uploadRoutes: FastifyPluginAsync = async (fastify) => {
    // Scoped to this plugin's routes only. Runs before hijack(), so a 401
    // goes out through Fastify's normal reply path.
    fastify.addHook('onRequest', fastify.requireSession);

    fastify.route({ method: TUS_METHODS, url: '/upload', handler: handleTus });
    fastify.route({ method: TUS_METHODS, url: '/upload/*', handler: handleTus });
};

export default uploadRoutes;
