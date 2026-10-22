import type { FastifyPluginAsync } from "fastify";

const usageRoutes: FastifyPluginAsync = async (fastify) => {
fastify.get('/usage', async(req, reply)=>{
    
})
};


export default usageRoutes