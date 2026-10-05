import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres'

// `max` is per process: every api replica and worker opens its own pool. Left unset, pg's default of 10 applies.
export function createDb(url: string, { max }: { max?: number } = {}) {
    const pool = new Pool({
        connectionString: url,
        max,
    });

    pool.on('error', (err) => {
        // A background/idle client errored — log it, don't crash the process
        console.error('Pool Connection Error: ', err);
    });

    return { pool, db: drizzle({ client: pool }) };
}

export type Db = ReturnType<typeof createDb>['db'];
