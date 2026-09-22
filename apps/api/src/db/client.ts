import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres'

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
});

pool.on('error', (err) => {
    // A background/idle client errored — log it, don't crash the process
    console.error('Pool Connection Error: ', err);
});

export const db = drizzle({ client: pool })
