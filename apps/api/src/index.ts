import Fastify from "fastify";
import type { ApiResponse } from "@bonitashare/shared-types";

const app = Fastify({ logger: true });

app.get("/health", async (): Promise<ApiResponse<{ status: "ok" }>> => {
  return { data: { status: "ok" }, error: null };
});

const port = Number(process.env.PORT ?? 3000);

app.listen({ port, host: "0.0.0.0" }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
