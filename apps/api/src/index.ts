import "dotenv/config";
import Fastify from "fastify";
import type { ApiResponse } from "@bonitashare/shared-types";
import { fastifyAutoload as autoload } from '@fastify/autoload'
import path from "path";
import { fileURLToPath } from "url";
import fastifyCookie from "@fastify/cookie";
import handleSession from "./plugins/custom/handleSession.js";
import { ensureBucket } from "./storage/client.js";
import { closeTusConnections } from "./upload/tusServer.js";
import { fileProcessingQueue } from "./queue/fileProcessing.js";
import { redisConnection } from "./queue/connection.js";
import { pool } from "./db/client.js";
import { onShutdown } from "./utils/shutdown.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = Fastify({ logger: true });

// Public and session-free. Sessions are only ever issued by GET /session;
// other routes opt into requireSession/optionalSession themselves.
app.get("/health", async (): Promise<ApiResponse<{ status: "ok" }>> => {
  return { data: { status: "ok" }, error: null };
});

app.register(fastifyCookie, {
  secret: process.env.COOKIE_SECRET,
  hook: 'onRequest'
})

app.register(handleSession)


app.addContentTypeParser(
  'application/offset+octet-stream',
  (_request, _payload, done) => done(null)
);


app.register(autoload, {
  dir: path.join(__dirname, 'routes')
})


const port = Number(process.env.PORT ?? 3000);

// Leaves room under onShutdown's hard deadline for closing Redis and Postgres afterwards.
const DRAIN_TIMEOUT_MS = 20_000;

onShutdown("api", async () => {
  // From here Fastify answers every new request (tus POSTs included) with 503 + Connection: close
  // before any handler runs, and waits for in-flight ones. A tus PATCH is one 5MB chunk, so the
  // wait is normally seconds; clients resume the rest of their upload from another replica or
  // after restart.
  // Past the drain timeout, cut the stragglers. Unlike a SIGKILL, tus still runs its cleanup and
  // releases the upload lock, so the client's resume doesn't have to wait out the lock TTL.
  const drainTimer = setTimeout(() => {
    app.log.warn("drain timeout reached, closing remaining connections");
    app.server.closeAllConnections();
  }, DRAIN_TIMEOUT_MS);
  await app.close();
  clearTimeout(drainTimer);

  // Reverse of startup order: Redis users first, Postgres last.
  await closeTusConnections();
  // BullMQ doesn't close a connection it was handed, so the queue and its connection close separately.
  await fileProcessingQueue.close();
  await redisConnection.quit();
  await pool.end();
});

ensureBucket()
  .then(() => app.listen({ port, host: "0.0.0.0" }))
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
