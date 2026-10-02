import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

// DATABASE_URL points at the `postgres` docker hostname, which only resolves inside the compose
// network. Scripts run from the host set DRIZZLE_FROM_HOST to reach it through the published port.
function databaseUrl() {
  const url = new URL(process.env.DATABASE_URL!);
  if (process.env.DRIZZLE_FROM_HOST) url.hostname = 'localhost';
  return url.toString();
}

export default defineConfig({
  out: './drizzle',
  schema: './src/db/schema.ts',
  dialect: 'postgresql',
  dbCredentials: {
    url: databaseUrl(),
  },
});
