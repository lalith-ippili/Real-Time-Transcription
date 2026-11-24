// Text helpers shared by the API (word counts, script-based language detection, titles).

const DEVANAGARI = /\p{Script=Devanagari}/gu;
const LATIN = /\p{Script=Latin}/gu;

export const countWords = (text = '') => {
  const trimmed = String(text).trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/u).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
};

/**
 * Detect language from the writing system used.
 *  - Devanagari only  → 'hi'
 *  - Latin only       → 'en'
 *  - both (≥ 10 % each) → 'mixed'  (typical Hindi–English code-switching)
 *  - neither          → 'other'
 */
export const detectLanguage = (text = '') => {
  const deva = (String(text).match(DEVANAGARI) || []).length;
  const latin = (String(text).match(LATIN) || []).length;
  const total = deva + latin;
  if (total === 0) return 'other';
  const devaShare = deva / total;
  if (devaShare >= 0.9) return 'hi';
  if (devaShare <= 0.1) return 'en';
  return 'mixed';
};

/** Build a short title from the first words of the transcript. */
export const makeTitle = (text = '', maxLength = 60) => {
  const clean = String(text).replace(/\s+/gu, ' ').trim();
  if (!clean) return 'Untitled transcription';
  if (clean.length <= maxLength) return clean;
  const cut = clean.slice(0, maxLength);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > 20 ? cut.slice(0, lastSpace) : cut).trim()}…`;
};

/** Escape LIKE/ILIKE wildcards so user search text is matched literally. */
export const escapeLike = (value = '') => String(value).replace(/[\\%_]/g, (c) => `\\${c}`);
