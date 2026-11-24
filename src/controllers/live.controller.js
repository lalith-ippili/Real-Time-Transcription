import { createLiveToken } from '../services/geminiLive.service.js';

// POST /api/live/token  → { token, model, apiVersion, config, expiresAt }
export const issueToken = async (req, res) => {
  const session = await createLiveToken();
  res.set('Cache-Control', 'no-store');
  res.status(201).json(session);
};
