-- =====================================================================
--  Speech-to-Text – PostgreSQL schema (Supabase compatible)
--  Safe to run multiple times (idempotent).
--  Run it in Supabase → SQL Editor, or `npm run migrate` from /backend.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.transcriptions (
    id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    title        VARCHAR(160) NOT NULL,
    content      TEXT         NOT NULL CHECK (char_length(btrim(content)) > 0),
    -- 'hi' (Devanagari), 'en' (Latin), 'mixed' (Hindi + English), 'other'
    language     VARCHAR(16)  NOT NULL DEFAULT 'mixed',
    -- which recogniser produced the text
    engine       VARCHAR(32)  NOT NULL DEFAULT 'manual',
    duration_ms  INTEGER      NOT NULL DEFAULT 0 CHECK (duration_ms >= 0),
    word_count   INTEGER      NOT NULL DEFAULT 0 CHECK (word_count >= 0),
    is_favorite  BOOLEAN      NOT NULL DEFAULT FALSE,
    metadata     JSONB        NOT NULL DEFAULT '{}'::jsonb,
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT transcriptions_language_chk
        CHECK (language IN ('hi', 'en', 'mixed', 'other')),
    CONSTRAINT transcriptions_engine_chk
        CHECK (engine IN ('gemini-live', 'whisper', 'web-speech', 'manual'))
);

CREATE INDEX IF NOT EXISTS idx_transcriptions_created_at
    ON public.transcriptions (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_transcriptions_language
    ON public.transcriptions (language);
CREATE INDEX IF NOT EXISTS idx_transcriptions_favorite
    ON public.transcriptions (is_favorite) WHERE is_favorite;

-- Keep updated_at fresh on every UPDATE.
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER trg_transcriptions_updated_at
    BEFORE UPDATE ON public.transcriptions
    FOR EACH ROW
    EXECUTE FUNCTION public.set_updated_at();

-- The API talks to Postgres directly (postgres role bypasses RLS).
-- Enabling RLS with no policies blocks the public Supabase REST API
-- (anon / publishable key) from reading or writing this table.
ALTER TABLE public.transcriptions ENABLE ROW LEVEL SECURITY;
