// Local development entry point: `npm run dev`
// (On Vercel the app is served by api/index.js instead.)
import app from './app.js';
import config, { envFileLoaded, envFilePath } from './config/env.js';
import { closePool, ensureSchema } from './db/index.js';

const describeDb = (url) => {
  try {
    const { hostname, port, username } = new URL(url);
    return `${username}@${hostname}:${port || 5432}`;
  } catch {
    return 'an unparseable DATABASE_URL';
  }
};

// Hints for the most common local-setup mistakes.
const dbHint = (err) => {
  const host = (() => {
    try {
      return new URL(config.db.url).hostname;
    } catch {
      return '';
    }
  })();
  if (['ENOTFOUND', 'ETIMEDOUT', 'ENETUNREACH', 'EHOSTUNREACH'].includes(err.code) && /^db\..+\.supabase\.co$/.test(host)) {
    return 'The direct Supabase host is IPv6-only. Use the pooler string from Supabase → Connect → Transaction pooler.';
  }
  if (err.code === '28P01' || /password authentication failed/i.test(err.message)) {
    return 'Wrong database password. If it contains @ # / ? or %, URL-encode it (for example @ → %40).';
  }
  if (/Tenant or user not found/i.test(err.message)) {
    return 'For the pooler the user must be postgres.<project-ref> (e.g. postgres.jdcmwroecgvidfgcucvw).';
  }
  return null;
};

const server = app.listen(config.port, async () => {
  console.log(`🚀 API ready on http://localhost:${config.port}`);
  console.log(envFileLoaded ? `📄 Loaded ${envFilePath}` : `⚠️  No .env file found at ${envFilePath}`);
  console.log(
    config.gemini.apiKey
      ? `🎙️  Gemini Live enabled (${config.gemini.model})`
      : '🎙️  Gemini Live disabled – set GEMINI_API_KEY to enable it',
  );
  console.log(`🌐 CORS allowed origins: ${config.corsOrigins.join(', ')}`);

  if (!config.db.url) {
    console.warn('⚠️  DATABASE_URL is not set – CRUD endpoints will return 503.');
    return;
  }
  if (config.db.url.includes('[YOUR-')) {
    console.warn('⚠️  DATABASE_URL still contains a [YOUR-…] placeholder – put your real password in.');
  }
  console.log(`🗄️  Connecting to ${describeDb(config.db.url)} …`);
  try {
    await ensureSchema();
    console.log('✅ Database connected and schema is ready');
  } catch (err) {
    console.error(`❌ Database connection failed: ${err.message}`);
    const hint = dbHint(err);
    if (hint) console.error(`   ↳ ${hint}`);
  }
});

const shutdown = async (signal) => {
  console.log(`\n${signal} received – shutting down…`);
  server.close(async () => {
    await closePool();
    process.exit(0);
  });
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
