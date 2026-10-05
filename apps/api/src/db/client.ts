import { createDb } from '@bonitashare/core/db';

export const { db, pool } = createDb(process.env.DATABASE_URL!);
