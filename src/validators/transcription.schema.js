import { z } from 'zod';

export const LANGUAGES = ['hi', 'en', 'mixed', 'other'];
export const ENGINES = ['gemini-live', 'whisper', 'web-speech', 'manual'];
export const SORT_FIELDS = ['created_at', 'updated_at', 'title', 'word_count', 'duration_ms'];

const metadata = z
  .record(z.string(), z.unknown())
  .refine((value) => JSON.stringify(value).length <= 5_000, {
    message: 'metadata must be smaller than 5 KB',
  });

const baseFields = {
  title: z.string().trim().max(160, 'title must be at most 160 characters'),
  content: z
    .string()
    .trim()
    .min(1, 'content cannot be empty')
    .max(50_000, 'content must be at most 50,000 characters'),
  language: z.enum(LANGUAGES),
  engine: z.enum(ENGINES),
  durationMs: z.number().int().min(0).max(24 * 60 * 60 * 1000),
  isFavorite: z.boolean(),
  metadata,
};

export const createTranscriptionSchema = z.object({
  title: baseFields.title.optional(),
  content: baseFields.content,
  language: baseFields.language.optional(),
  engine: baseFields.engine.default('manual'),
  durationMs: baseFields.durationMs.default(0),
  isFavorite: baseFields.isFavorite.default(false),
  metadata: metadata.default({}),
});

export const updateTranscriptionSchema = z
  .object({
    title: baseFields.title.optional(),
    content: baseFields.content.optional(),
    language: baseFields.language.optional(),
    engine: baseFields.engine.optional(),
    durationMs: baseFields.durationMs.optional(),
    isFavorite: baseFields.isFavorite.optional(),
    metadata: metadata.optional(),
  })
  .refine((data) => Object.values(data).some((v) => v !== undefined), {
    message: 'Provide at least one field to update',
  });

export const listQuerySchema = z.object({
  search: z.string().trim().max(200).optional(),
  language: z.enum(LANGUAGES).optional(),
  engine: z.enum(ENGINES).optional(),
  favorite: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  sortBy: z.enum(SORT_FIELDS).default('created_at'),
  order: z.enum(['asc', 'desc']).default('desc'),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(10),
});

export const idParamSchema = z.object({
  id: z.uuid('id must be a valid UUID'),
});

export const bulkDeleteSchema = z.object({
  ids: z.array(z.uuid()).min(1, 'ids must contain at least one id').max(100),
});

// The browser may ask for the fallback model or the other API version when the
// first attempt fails. Unknown keys are rejected to keep the contract explicit.
export const liveTokenSchema = z
  .object({
    variant: z.enum(['primary', 'fallback']).default('primary'),
    apiVersion: z.enum(['v1beta', 'v1alpha']).optional(),
  })
  .strict();
