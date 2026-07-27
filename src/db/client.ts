import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgres://admin:kodimperi@localhost:5433/mta';

export const pool = new pg.Pool({ connectionString: DATABASE_URL });
export const db = drizzle(pool);
