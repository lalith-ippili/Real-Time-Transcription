import config from '../config/env.js';
import { pingDatabase } from '../db/index.js';
import { isGeminiConfigured, liveModels } from '../services/geminiLive.service.js';
import { diagnoseDbError } from '../utils/dbDiagnostics.js';
import { isRelayEnabled } from '../live/relay.js';

// GET /api/health – used by the UI (and Render's health check) to see what works.
export const health = async (_req, res) => {
  let database;
  try {
    const latencyMs = await pingDatabase();
    database = { status: 'up', latencyMs };
  } catch (err) {
    // reason + hint are safe to expose (no secrets); the raw error only outside production.
    const { reason, hint } = diagnoseDbError(err, config.db.url);
    database = { status: 'down', reason, hint };
    if (!config.isProduction) database.error = err.message;
  }

  const ok = database.status === 'up';
  res.set('Cache-Control', 'no-store');
  res.status(ok ? 200 : 503).json({
    status: ok ? 'ok' : 'degraded',
    time: new Date().toISOString(),
    uptimeSeconds: Math.round(process.uptime()),
    database,
    engines: {
      geminiLive: {
        available: isGeminiConfigured(),
        model: liveModels().primary,
        fallbackModel: liveModels().fallback,
        relay: isRelayEnabled(), // server-side WebSocket relay at /api/live/stream
      },
      whisper: { available: true, note: 'runs in the browser (open-source, on-device)' },
      webSpeech: { available: true, note: 'depends on browser support' },
    },
  });
};
