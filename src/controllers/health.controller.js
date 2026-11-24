import config from '../config/env.js';
import { pingDatabase } from '../db/index.js';
import { isGeminiConfigured } from '../services/geminiLive.service.js';

// GET /api/health – used by the UI to show which engines are available.
export const health = async (_req, res) => {
  let database = { status: 'down' };
  try {
    const latencyMs = await pingDatabase();
    database = { status: 'up', latencyMs };
  } catch (err) {
    database = { status: 'down', error: config.isProduction ? undefined : err.message };
  }

  const ok = database.status === 'up';
  res.status(ok ? 200 : 503).json({
    status: ok ? 'ok' : 'degraded',
    time: new Date().toISOString(),
    database,
    engines: {
      geminiLive: { available: isGeminiConfigured(), model: config.gemini.model },
      whisper: { available: true, note: 'runs in the browser (open-source, on-device)' },
      webSpeech: { available: true, note: 'depends on browser support' },
    },
  });
};
