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

ensureBucket()
  .then(() => app.listen({ port, host: "0.0.0.0" }))
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
