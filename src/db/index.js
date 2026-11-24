import { readFileSync } from 'node:fs';
import pg from 'pg';
import config from '../config/env.js';

const { Pool, types } = pg;

// Return BIGINT (COUNT/SUM) as JS numbers instead of strings.
types.setTypeParser(20, (v) => (v === null ? null : Number.parseInt(v, 10)));

let pool = null;
let schemaReady = null;

/**
 * Strip `sslmode` from the URL: node-postgres treats `sslmode=require` as
 * full certificate verification, which fails against Supabase's CA chain.
 * SSL is configured explicitly below instead.
 */
const normaliseConnectionString = (url) => {
  try {
    const parsed = new URL(url);
    parsed.searchParams.delete('sslmode');
    return parsed.toString();
  } catch {
    return url;
  }
};

export const getPool = () => {
  if (!config.db.url) {
    const err = new Error('DATABASE_URL is not configured');
    err.status = 503;
    throw err;
  }
  if (!pool) {
    pool = new Pool({
      connectionString: normaliseConnectionString(config.db.url),
      ssl: config.db.ssl ? { rejectUnauthorized: false } : false,
      // Serverless functions should keep very few connections each;
      // use Supabase's pooler (port 6543) in production.
      max: config.db.poolMax,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 10_000,
      allowExitOnIdle: true,
    });
    pool.on('error', (err) => {
      console.error('[db] idle client error:', err.message);
    });
  }
  return pool;
};

const SCHEMA_LOCK_KEY = 732_001; // arbitrary app-wide advisory lock id

/** Apply schema.sql inside a transaction guarded by an advisory lock. */
export const runMigrations = async () => {
  const sql = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [SCHEMA_LOCK_KEY]);
    await client.query(sql);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
};

/** Ensure the schema exists once per process (cold start) when auto-migrate is on. */
export const ensureSchema = () => {
  if (!config.db.autoMigrate) return Promise.resolve();
  if (!schemaReady) {
    schemaReady = runMigrations().catch((err) => {
      schemaReady = null; // retry on next request
      throw err;
    });
  }
  return schemaReady;
};

export const query = async (text, params) => {
  await ensureSchema();
  return getPool().query(text, params);
};

export const pingDatabase = async () => {
  const started = Date.now();
  await getPool().query('SELECT 1');
  return Date.now() - started;
};

export const closePool = async () => {
  if (pool) {
    await pool.end();
    pool = null;
    schemaReady = null;
  }
};
