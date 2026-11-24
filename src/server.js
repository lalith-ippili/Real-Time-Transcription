// Local development entry point: `npm run dev`
// (On Vercel the app is served by api/index.js instead.)
import app from './app.js';
import config, { envFileLoaded, envFilePath } from './config/env.js';
import { closePool, ensureSchema } from './db/index.js';
import { diagnoseDbError } from './utils/dbDiagnostics.js';

const describeDb = (url) => {
  try {
    const { hostname, port, username } = new URL(url);
    return `${username}@${hostname}:${port || 5432}`;
  } catch {
    return 'an unparseable DATABASE_URL';
  }
};

const server = app.listen(config.port, async () => {
  console.log(`🚀 API ready on http://localhost:${config.port}`);
  console.log(envFileLoaded ? `📄 Loaded ${envFilePath}` : `⚠️  No .env file found at ${envFilePath}`);
  console.log(
    config.gemini.apiKey
      ? `🎙️  Gemini Live enabled (${config.gemini.transcribeModel}, fallback ${config.gemini.model}, ${config.gemini.apiVersion})`
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
    const { hint } = diagnoseDbError(err, config.db.url);
    if (hint) console.error(`   ↳ ${hint}`);
  }
});

// Render / other load balancers keep idle connections open longer than Node's
// 5 s default; a shorter server timeout causes random 502s on reused sockets.
server.keepAliveTimeout = 120_000;
server.headersTimeout = 121_000;

const shutdown = async (signal) => {
  console.log(`\n${signal} received – shutting down…`);
  server.close(async () => {
    await closePool();
    process.exit(0);
  });
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
