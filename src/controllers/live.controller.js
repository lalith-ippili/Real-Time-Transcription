import { createLiveToken } from '../services/geminiLive.service.js';

// POST /api/live/token  { variant?: 'primary'|'fallback', apiVersion?: 'v1beta'|'v1alpha' }
// → { token, model, mode, apiVersion, setup, expiresAt }
export const issueToken = async (req, res) => {
  const session = await createLiveToken(req.valid.body);
  res.set('Cache-Control', 'no-store');
  res.status(201).json(session);
};
