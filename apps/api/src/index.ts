import "dotenv/config";
import Fastify from "fastify";
import type { ApiResponse } from "@bonitashare/shared-types";
import { fastifyAutoload as autoload } from '@fastify/autoload'
import path from "path";
import { fileURLToPath } from "url";
import fastifyCookie from "@fastify/cookie";
import handleSession from "./plugins/custom/handleSession.js";
import { ensureBucket } from "./storage/client.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = Fastify({ logger: true });

// Declared before fastifyCookie/handleSession are registered, so it's
// outside the session hook's chain on purpose. the Docker healthcheck
// polls this every 5s and must not spawn an anonymous session each time.
app.get("/health", async (): Promise<ApiResponse<{ status: "ok" }>> => {
  return { data: { status: "ok" }, error: null };
});

app.register(fastifyCookie, {
  secret: process.env.COOKIE_SECRET,
  hook: 'onRequest'
})

app.register(handleSession)

app.register(autoload, {
  dir: path.join(__dirname, 'routes')
})


const port = Number(process.env.PORT ?? 3000);

ensureBucket()
  .then(() => app.listen({ port, host: "0.0.0.0" }))
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
