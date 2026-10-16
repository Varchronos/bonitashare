import type { FastifyPluginAsync, FastifyReply, FastifyRequest, HTTPMethods } from 'fastify';
import { tusServer } from '@/upload/tusServer.js';
import { resolveTier } from '@/upload/tier.js';

const TUS_METHODS: HTTPMethods[] = ['GET', 'POST', 'PATCH', 'HEAD', 'DELETE', 'OPTIONS'];

async function handleTus(req: FastifyRequest, reply: FastifyReply) {
    // Only creating an upload is checked against the tier's limits.
    const tier = req.method === 'POST' ? await resolveTier(req.userId) : null;

    // Stashed here so onUploadCreate can attribute the upload to a user and apply their limits —
    // tus only ever sees the raw Node req, not the Fastify request.
    Object.assign(req.raw, { userId: req.userId, tier });

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

    // Served at /api/v1/upload (autoload adds the prefix): the same path the browser uses, so in prod
    // the tunnel can route uploads here directly instead of through the web app's proxy.
    fastify.route({ method: TUS_METHODS, url: '/upload', handler: handleTus });
    fastify.route({ method: TUS_METHODS, url: '/upload/*', handler: handleTus });
};

export default uploadRoutes;
