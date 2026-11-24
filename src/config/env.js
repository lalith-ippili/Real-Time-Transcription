// Centralised, validated runtime configuration.
// Locally, values are read from backend/.env. On Vercel, set the same keys under
// Project → Settings → Environment Variables (no .env file is used there).
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ENV_PATH = fileURLToPath(new URL('../../.env', import.meta.url)); // backend/.env

/**
 * Load backend/.env no matter which folder `npm run dev` is started from.
 * Uses Node's built-in loader when available and a tiny parser otherwise
 * (older Node versions). Real environment variables always win.
 */
const loadDotEnv = () => {
  if (!existsSync(ENV_PATH)) {
    if (existsSync(`${ENV_PATH}.txt`)) {
      console.warn('⚠️  Found backend/.env.txt – rename it to exactly ".env" (no .txt) so it is loaded.');
    }
    return false;
  }
  const text = readFileSync(ENV_PATH, 'utf8');
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim().replace(/^export\s+/, '');
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    } else {
      value = value.replace(/\s+#.*$/, ''); // strip trailing " # comment"
    }
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
  return true;
};

export const envFileLoaded = loadDotEnv();
export const envFilePath = ENV_PATH;

const bool = (value, fallback) => {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
};

const int = (value, fallback) => {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
};

const list = (value) =>
  String(value || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

const nodeEnv = process.env.NODE_ENV || 'development';
const databaseUrl = process.env.DATABASE_URL || '';

// SSL: Supabase requires TLS; local Postgres usually has none.
// DB_SSL=auto (default) enables SSL for every host except localhost.
const resolveSsl = () => {
  const mode = (process.env.DB_SSL || 'auto').toLowerCase();
  if (mode !== 'auto') return bool(mode, true);
  try {
    const { hostname } = new URL(databaseUrl);
    return !['localhost', '127.0.0.1', '::1', ''].includes(hostname);
  } catch {
    return true;
  }
};

export const config = Object.freeze({
  nodeEnv,
  isProduction: nodeEnv === 'production',
  isTest: nodeEnv === 'test',
  port: int(process.env.PORT, 5000),

  // Comma-separated list of allowed browser origins, e.g.
  // "https://your-app.netlify.app,http://localhost:5173". Use "*" to allow all.
  corsOrigins: list(
    process.env.CORS_ORIGIN || 'http://localhost:5173,https://realtimetranscription.netlify.app',
  ),

  db: {
    url: databaseUrl,
    ssl: resolveSsl(),
    // Serverless (Vercel) → few connections per instance; long-running server (Render) → more.
    poolMax: int(process.env.DB_POOL_MAX, process.env.VERCEL ? 3 : 10),
    autoMigrate: bool(process.env.DB_AUTO_MIGRATE, true),
  },

  gemini: {
    apiKey: process.env.GEMINI_API_KEY || '',
    // Primary: Google's dedicated real-time speech-to-text model (interim + final text).
    transcribeModel: process.env.GEMINI_TRANSCRIBE_MODEL || 'gemini-3.5-transcribe-live',
    // Fallback: conversational Live model, used automatically if the primary is unavailable.
    model: process.env.GEMINI_LIVE_MODEL || 'gemini-3.1-flash-live-preview',
    // Ephemeral tokens are documented for v1beta; the browser retries v1alpha if needed.
    apiVersion: process.env.GEMINI_API_VERSION || 'v1beta',
    // Lock the model/config into the ephemeral token (recommended).
    lockConfig: bool(process.env.GEMINI_LOCK_CONFIG, true),
    tokenTtlMinutes: int(process.env.GEMINI_TOKEN_TTL_MINUTES, 30),
  },

  rateLimit: {
    windowMs: 60_000,
    apiMax: int(process.env.RATE_LIMIT_PER_MINUTE, 120),
    tokenMax: int(process.env.TOKEN_RATE_LIMIT_PER_MINUTE, 30),
  },
});

export default config;
