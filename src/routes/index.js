import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import config from '../config/env.js';
import * as transcriptions from '../controllers/transcription.controller.js';
import * as live from '../controllers/live.controller.js';
import { health } from '../controllers/health.controller.js';
import { validate } from '../middleware/validate.js';
import {
  bulkDeleteSchema,
  createTranscriptionSchema,
  idParamSchema,
  listQuerySchema,
  liveTokenSchema,
  updateTranscriptionSchema,
} from '../validators/transcription.schema.js';

const router = Router();

const tokenLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  limit: config.rateLimit.tokenMax,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: { message: 'Too many live-session requests, please wait a minute.' } },
});

// ── Health ────────────────────────────────────────────────────────────────
router.get('/health', health);

// ── Real-time transcription (Gemini Live ephemeral token) ────────────────
router.post('/live/token', tokenLimiter, validate({ body: liveTokenSchema }), live.issueToken);

// ── Transcriptions CRUD ───────────────────────────────────────────────────
router.get('/transcriptions/stats', transcriptions.stats);
router.get('/transcriptions', validate({ query: listQuerySchema }), transcriptions.list);
router.post('/transcriptions', validate({ body: createTranscriptionSchema }), transcriptions.create);
router.delete('/transcriptions', validate({ body: bulkDeleteSchema }), transcriptions.removeMany);
router.get('/transcriptions/:id', validate({ params: idParamSchema }), transcriptions.getOne);
router.put(
  '/transcriptions/:id',
  validate({ params: idParamSchema, body: updateTranscriptionSchema }),
  transcriptions.update,
);
router.patch(
  '/transcriptions/:id',
  validate({ params: idParamSchema, body: updateTranscriptionSchema }),
  transcriptions.update,
);
router.delete('/transcriptions/:id', validate({ params: idParamSchema }), transcriptions.remove);

export default router;
