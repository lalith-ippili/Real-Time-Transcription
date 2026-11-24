import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { rateLimit } from 'express-rate-limit';
import config from './config/env.js';
import routes from './routes/index.js';
import { errorHandler, notFound } from './middleware/errorHandler.js';

const app = express();

// Vercel / proxies put the client IP in X-Forwarded-For.
app.set('trust proxy', 1);
app.disable('x-powered-by');

// ── CORS ──────────────────────────────────────────────────────────────────
// CORS_ORIGIN supports exact origins, "*" and wildcards such as
// "https://*.netlify.app" (handy for Netlify deploy previews).
const originMatchers = config.corsOrigins.map((pattern) => {
  if (pattern === '*') return () => true;
  if (!pattern.includes('*')) return (origin) => origin === pattern.replace(/\/$/, '');
  const regex = new RegExp(
    `^${pattern
      .replace(/\/$/, '')
      .split('*')
      .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('[^/]+')}$`,
  );
  return (origin) => regex.test(origin);
});

app.use(
  cors({
    origin(origin, callback) {
      // Allow same-origin / server-to-server / curl requests (no Origin header).
      if (!origin || originMatchers.some((match) => match(origin))) return callback(null, true);
      return callback(null, false);
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    maxAge: 86_400,
  }),
);

app.use(helmet());
app.use(express.json({ limit: '200kb' }));
if (!config.isTest) app.use(morgan(config.isProduction ? 'combined' : 'dev'));

app.use(
  '/api',
  rateLimit({
    windowMs: config.rateLimit.windowMs,
    limit: config.rateLimit.apiMax,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    skip: () => config.isTest,
    message: { error: { message: 'Too many requests, please slow down.' } },
  }),
);

app.get('/', (_req, res) => {
  res.json({
    name: 'Speech-to-Text API',
    version: '1.0.0',
    docs: 'See README.md → API reference',
    endpoints: [
      'GET    /api/health',
      'POST   /api/live/token',
      'GET    /api/transcriptions',
      'GET    /api/transcriptions/stats',
      'GET    /api/transcriptions/:id',
      'POST   /api/transcriptions',
      'PUT    /api/transcriptions/:id',
      'PATCH  /api/transcriptions/:id',
      'DELETE /api/transcriptions/:id',
      'DELETE /api/transcriptions',
    ],
  });
});

app.use('/api', routes);

app.use(notFound);
app.use(errorHandler);

export default app;
