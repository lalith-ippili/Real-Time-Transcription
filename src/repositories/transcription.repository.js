// all SQL lives here (parameterised)

import { query } from '../db/index.js';
import { escapeLike } from '../utils/text.js';

const COLUMNS = `
  id, title, content, language, engine, duration_ms, word_count,
  is_favorite, metadata, created_at, updated_at
`;

// Whitelisted ORDER BY columns (never interpolate user input directly).
const SORTABLE = {
  created_at: 'created_at',
  updated_at: 'updated_at',
  title: 'lower(title)',
  word_count: 'word_count',
  duration_ms: 'duration_ms',
};

// camelCase API field → snake_case column
const WRITABLE = {
  title: 'title',
  content: 'content',
  language: 'language',
  engine: 'engine',
  durationMs: 'duration_ms',
  wordCount: 'word_count',
  isFavorite: 'is_favorite',
  metadata: 'metadata',
};

export const toDto = (row) =>
  row && {
    id: row.id,
    title: row.title,
    content: row.content,
    language: row.language,
    engine: row.engine,
    durationMs: row.duration_ms,
    wordCount: row.word_count,
    isFavorite: row.is_favorite,
    metadata: row.metadata,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };

const buildFilters = ({ search, language, engine, favorite }) => {
  const where = [];
  const params = [];

  if (search) {
    params.push(`%${escapeLike(search)}%`);
    where.push(`(title ILIKE $${params.length} OR content ILIKE $${params.length})`);
  }
  if (language) {
    params.push(language);
    where.push(`language = $${params.length}`);
  }
  if (engine) {
    params.push(engine);
    where.push(`engine = $${params.length}`);
  }
  if (typeof favorite === 'boolean') {
    params.push(favorite);
    where.push(`is_favorite = $${params.length}`);
  }

  return { whereSql: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
};

/**
 * One round-trip per page: COUNT(*) OVER() returns the total alongside the rows.
 * (Only an out-of-range page needs a second, count-only query.)
 */
export const findMany = async ({ page, limit, sortBy, order, ...filters }) => {
  const { whereSql, params } = buildFilters(filters);
  const orderSql = `${SORTABLE[sortBy] || 'created_at'} ${order === 'asc' ? 'ASC' : 'DESC'}, id ASC`;
  const offset = (page - 1) * limit;

  const { rows } = await query(
    `SELECT ${COLUMNS}, COUNT(*) OVER()::bigint AS total_count
     FROM transcriptions ${whereSql}
     ORDER BY ${orderSql}
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, offset],
  );

  let total = rows[0]?.total_count ?? 0;
  if (rows.length === 0 && page > 1) {
    const count = await query(`SELECT COUNT(*)::bigint AS total FROM transcriptions ${whereSql}`, params);
    total = count.rows[0].total;
  }

  return {
    items: rows.map(toDto),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    },
  };
};

export const findById = async (id) => {
  const { rows } = await query(`SELECT ${COLUMNS} FROM transcriptions WHERE id = $1`, [id]);
  return toDto(rows[0]) || null;
};

export const create = async (data) => {
  const fields = Object.keys(WRITABLE).filter((key) => data[key] !== undefined);
  const columns = fields.map((key) => WRITABLE[key]);
  const values = fields.map((key) => (key === 'metadata' ? JSON.stringify(data[key]) : data[key]));
  const placeholders = fields.map((_, i) => `$${i + 1}`);

  const { rows } = await query(
    `INSERT INTO transcriptions (${columns.join(', ')})
     VALUES (${placeholders.join(', ')})
     RETURNING ${COLUMNS}`,
    values,
  );
  return toDto(rows[0]);
};

export const update = async (id, data) => {
  const fields = Object.keys(WRITABLE).filter((key) => data[key] !== undefined);
  if (fields.length === 0) return findById(id);

  const sets = fields.map((key, i) => `${WRITABLE[key]} = $${i + 2}`);
  const values = fields.map((key) => (key === 'metadata' ? JSON.stringify(data[key]) : data[key]));

  const { rows } = await query(
    `UPDATE transcriptions SET ${sets.join(', ')}
     WHERE id = $1
     RETURNING ${COLUMNS}`,
    [id, ...values],
  );
  return toDto(rows[0]) || null;
};

export const remove = async (id) => {
  const { rowCount } = await query('DELETE FROM transcriptions WHERE id = $1', [id]);
  return rowCount > 0;
};

export const removeMany = async (ids) => {
  const { rows } = await query('DELETE FROM transcriptions WHERE id = ANY($1::uuid[]) RETURNING id', [ids]);
  return rows.map((r) => r.id);
};

/** All dashboard numbers in a single query (one round-trip to the database). */
export const getStats = async () => {
  const { rows } = await query(`
    WITH t AS (
      SELECT language, engine, is_favorite, word_count, duration_ms, created_at
      FROM transcriptions
    )
    SELECT
      (SELECT COUNT(*) FROM t)::bigint                              AS total,
      (SELECT COALESCE(SUM(word_count), 0) FROM t)::bigint          AS words,
      (SELECT COALESCE(SUM(duration_ms), 0) FROM t)::bigint         AS duration_ms,
      (SELECT COUNT(*) FROM t WHERE is_favorite)::bigint            AS favorites,
      COALESCE((SELECT json_object_agg(language, c)
                FROM (SELECT language, COUNT(*) AS c FROM t GROUP BY language) l), '{}'::json) AS by_language,
      COALESCE((SELECT json_object_agg(engine, c)
                FROM (SELECT engine, COUNT(*) AS c FROM t GROUP BY engine) e), '{}'::json)     AS by_engine,
      (SELECT json_agg(json_build_object('day', to_char(d.day, 'YYYY-MM-DD'), 'count', d.count) ORDER BY d.day)
       FROM (
         SELECT g.day, (SELECT COUNT(*) FROM t WHERE t.created_at::date = g.day::date) AS count
         FROM generate_series((CURRENT_DATE - 6)::timestamp, CURRENT_DATE::timestamp, INTERVAL '1 day') AS g(day)
       ) d)                                                         AS last7
  `);

  const r = rows[0];
  return {
    total: r.total,
    totalWords: r.words,
    totalDurationMs: r.duration_ms,
    favorites: r.favorites,
    byLanguage: r.by_language,
    byEngine: r.by_engine,
    last7Days: r.last7,
  };
};
