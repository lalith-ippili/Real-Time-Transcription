import * as repo from '../repositories/transcription.repository.js';
import HttpError from '../utils/httpError.js';
import { countWords, detectLanguage, makeTitle } from '../utils/text.js';

// GET /api/transcriptions
export const list = async (req, res) => {
  const result = await repo.findMany(req.valid.query);
  res.json(result);
};

// GET /api/transcriptions/stats
export const stats = async (_req, res) => {
  res.json(await repo.getStats());
};

// GET /api/transcriptions/:id
export const getOne = async (req, res) => {
  const item = await repo.findById(req.valid.params.id);
  if (!item) throw HttpError.notFound('Transcription not found');
  res.json(item);
};

// POST /api/transcriptions
export const create = async (req, res) => {
  const body = req.valid.body;
  const item = await repo.create({
    ...body,
    title: body.title || makeTitle(body.content),
    language: body.language || detectLanguage(body.content),
    wordCount: countWords(body.content),
  });
  res.status(201).location(`/api/transcriptions/${item.id}`).json(item);
};

// PUT|PATCH /api/transcriptions/:id
export const update = async (req, res) => {
  const { id } = req.valid.params;
  const body = { ...req.valid.body };

  if (body.content !== undefined) {
    body.wordCount = countWords(body.content);
    if (body.language === undefined) body.language = detectLanguage(body.content);
  }
  if (body.title !== undefined && body.title === '') {
    const existing = await repo.findById(id);
    if (!existing) throw HttpError.notFound('Transcription not found');
    body.title = makeTitle(body.content ?? existing.content);
  }

  const item = await repo.update(id, body);
  if (!item) throw HttpError.notFound('Transcription not found');
  res.json(item);
};

// DELETE /api/transcriptions/:id
export const remove = async (req, res) => {
  const deleted = await repo.remove(req.valid.params.id);
  if (!deleted) throw HttpError.notFound('Transcription not found');
  res.status(204).end();
};

// DELETE /api/transcriptions   { ids: [...] }
export const removeMany = async (req, res) => {
  const deletedIds = await repo.removeMany(req.valid.body.ids);
  res.json({ deleted: deletedIds.length, ids: deletedIds });
};
