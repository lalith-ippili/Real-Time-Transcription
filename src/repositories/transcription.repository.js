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

export const findMany = async ({ page, limit, sortBy, order, ...filters }) => {
  const { whereSql, params } = buildFilters(filters);
  const orderSql = `${SORTABLE[sortBy] || 'created_at'} ${order === 'asc' ? 'ASC' : 'DESC'}, id ASC`;
  const offset = (page - 1) * limit;

  const listParams = [...params, limit, offset];
  const [rows, count] = await Promise.all([
    query(
      `SELECT ${COLUMNS} FROM transcriptions ${whereSql}
       ORDER BY ${orderSql}
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      listParams,
    ),
    query(`SELECT COUNT(*)::bigint AS total FROM transcriptions ${whereSql}`, params),
  ]);

  const total = count.rows[0].total;
  return {
    items: rows.rows.map(toDto),
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

export const getStats = async () => {
  const [totals, byLanguage, byEngine, daily] = await Promise.all([
    query(`
      SELECT COUNT(*)::bigint                       AS total,
             COALESCE(SUM(word_count), 0)::bigint   AS words,
             COALESCE(SUM(duration_ms), 0)::bigint  AS duration_ms,
             COUNT(*) FILTER (WHERE is_favorite)::bigint AS favorites
      FROM transcriptions`),
    query(`SELECT language AS key, COUNT(*)::bigint AS count
           FROM transcriptions GROUP BY language ORDER BY count DESC`),
    query(`SELECT engine AS key, COUNT(*)::bigint AS count
           FROM transcriptions GROUP BY engine ORDER BY count DESC`),
    query(`
      SELECT to_char(d.day, 'YYYY-MM-DD') AS day, COUNT(t.id)::bigint AS count
      FROM generate_series(
             (CURRENT_DATE - INTERVAL '6 days')::date, CURRENT_DATE, INTERVAL '1 day'
           ) AS d(day)
      LEFT JOIN transcriptions t ON t.created_at::date = d.day::date
      GROUP BY d.day ORDER BY d.day`),
  ]);

  const t = totals.rows[0];
  const toMap = (rows) => Object.fromEntries(rows.map((r) => [r.key, r.count]));

  return {
    total: t.total,
    totalWords: t.words,
    totalDurationMs: t.duration_ms,
    favorites: t.favorites,
    byLanguage: toMap(byLanguage.rows),
    byEngine: toMap(byEngine.rows),
    last7Days: daily.rows,
  };
};
