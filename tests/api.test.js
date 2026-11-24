// Integration tests against a real PostgreSQL database.
// Run with:  TEST_DATABASE_URL=postgresql://user:pass@localhost:5432/stt_test npm test
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';

const TEST_DB = process.env.TEST_DATABASE_URL;

describe('Transcriptions API', { skip: !TEST_DB && 'TEST_DATABASE_URL not set' }, () => {
  let app;
  let db;

  before(async () => {
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL = TEST_DB;
    process.env.GEMINI_API_KEY = '';
    app = (await import('../src/app.js')).default;
    db = await import('../src/db/index.js');
    await db.runMigrations();
    await db.getPool().query('TRUNCATE transcriptions');
  });

  after(async () => {
    await db?.closePool();
  });

  let created;

  test('GET /api/health reports database up and engine availability', async () => {
    const res = await request(app).get('/api/health').expect(200);
    assert.equal(res.body.database.status, 'up');
    assert.equal(res.body.engines.geminiLive.available, false);
  });

  test('POST /api/transcriptions creates a record with derived fields', async () => {
    const res = await request(app)
      .post('/api/transcriptions')
      .send({
        content: 'मुझे कल office जाना है for the client meeting',
        engine: 'gemini-live',
        durationMs: 4200,
      })
      .expect(201);

    created = res.body;
    assert.match(created.id, /^[0-9a-f-]{36}$/);
    assert.equal(created.language, 'mixed');
    assert.equal(created.wordCount, 9);
    assert.equal(created.engine, 'gemini-live');
    assert.equal(created.durationMs, 4200);
    assert.equal(created.isFavorite, false);
    assert.ok(created.title.length > 0);
    assert.ok(res.headers.location.endsWith(created.id));
  });

  test('POST /api/transcriptions validates input', async () => {
    const res = await request(app).post('/api/transcriptions').send({ content: '   ' }).expect(400);
    assert.equal(res.body.error.message, 'Validation failed');
    assert.equal(res.body.error.details[0].field, 'content');

    await request(app).post('/api/transcriptions').send({ content: 'x', engine: 'nope' }).expect(400);
    await request(app)
      .post('/api/transcriptions')
      .set('Content-Type', 'application/json')
      .send('{bad json')
      .expect(400);
  });

  test('GET /api/transcriptions/:id returns the record, 404 for unknown, 400 for bad id', async () => {
    const res = await request(app).get(`/api/transcriptions/${created.id}`).expect(200);
    assert.equal(res.body.content, created.content);

    await request(app).get('/api/transcriptions/00000000-0000-4000-8000-000000000000').expect(404);
    await request(app).get('/api/transcriptions/not-a-uuid').expect(400);
  });

  test('PUT /api/transcriptions/:id updates content and recomputes metadata', async () => {
    await new Promise((r) => setTimeout(r, 20));
    const res = await request(app)
      .put(`/api/transcriptions/${created.id}`)
      .send({ content: 'Only English words now', title: 'Edited title', isFavorite: true })
      .expect(200);

    assert.equal(res.body.title, 'Edited title');
    assert.equal(res.body.language, 'en');
    assert.equal(res.body.wordCount, 4);
    assert.equal(res.body.isFavorite, true);
    assert.ok(new Date(res.body.updatedAt) > new Date(res.body.createdAt));

    await request(app).put(`/api/transcriptions/${created.id}`).send({}).expect(400);
  });

  test('GET /api/transcriptions supports search, filters, sorting and pagination', async () => {
    const samples = [
      { content: 'आज मौसम बहुत अच्छा है', engine: 'whisper' },
      { content: 'Please schedule the demo for Monday', engine: 'web-speech' },
      { content: 'Kal ka plan kya hai? मुझे बताओ', engine: 'gemini-live' },
      { content: '100% guaranteed_discount text', engine: 'manual' },
    ];
    for (const body of samples) {
      await request(app).post('/api/transcriptions').send(body).expect(201);
    }

    const all = await request(app).get('/api/transcriptions?limit=2&page=1').expect(200);
    assert.equal(all.body.items.length, 2);
    assert.equal(all.body.pagination.total, 5);
    assert.equal(all.body.pagination.totalPages, 3);

    const hindi = await request(app).get('/api/transcriptions?language=hi').expect(200);
    assert.equal(hindi.body.items.length, 1);
    assert.equal(hindi.body.items[0].engine, 'whisper');

    const search = await request(app).get('/api/transcriptions?search=DEMO').expect(200);
    assert.equal(search.body.items.length, 1);

    // % and _ must be matched literally
    const literal = await request(app).get('/api/transcriptions?search=0%25%20g').expect(200);
    assert.equal(literal.body.items.length, 1);
    const wildcard = await request(app).get('/api/transcriptions?search=%25').expect(200);
    assert.equal(wildcard.body.items.length, 1);

    const favs = await request(app).get('/api/transcriptions?favorite=true').expect(200);
    assert.equal(favs.body.items.length, 1);

    const byWords = await request(app).get('/api/transcriptions?sortBy=word_count&order=asc').expect(200);
    const counts = byWords.body.items.map((i) => i.wordCount);
    assert.deepEqual(counts, [...counts].sort((a, b) => a - b));

    // A page past the end still reports the real total.
    const beyond = await request(app).get('/api/transcriptions?limit=2&page=9').expect(200);
    assert.equal(beyond.body.items.length, 0);
    assert.equal(beyond.body.pagination.total, 5);

    await request(app).get('/api/transcriptions?sortBy=drop_table').expect(400);
    await request(app).get('/api/transcriptions?limit=1000').expect(400);
  });

  test('GET /api/transcriptions/stats aggregates totals', async () => {
    const res = await request(app).get('/api/transcriptions/stats').expect(200);
    assert.equal(res.body.total, 5);
    assert.equal(res.body.favorites, 1);
    assert.equal(res.body.last7Days.length, 7);
    assert.equal(res.body.last7Days.at(-1).count, 5);
    assert.equal(res.body.byEngine['gemini-live'], 2);
  });

  test('DELETE endpoints remove single and multiple records', async () => {
    await request(app).delete(`/api/transcriptions/${created.id}`).expect(204);
    await request(app).delete(`/api/transcriptions/${created.id}`).expect(404);

    const list = await request(app).get('/api/transcriptions?limit=100').expect(200);
    const ids = list.body.items.slice(0, 2).map((i) => i.id);
    const res = await request(app).delete('/api/transcriptions').send({ ids }).expect(200);
    assert.equal(res.body.deleted, 2);

    const remaining = await request(app).get('/api/transcriptions').expect(200);
    assert.equal(remaining.body.pagination.total, 2);
  });

  test('POST /api/live/token returns 503 when Gemini is not configured', async () => {
    const res = await request(app).post('/api/live/token').send({}).expect(503);
    assert.match(res.body.error.message, /GEMINI_API_KEY/);
    await request(app).post('/api/live/token').send({ unexpected: true }).expect(400);
    await request(app).post('/api/live/token').send({ variant: 'nope' }).expect(400);
    await request(app).post('/api/live/token').send({ apiVersion: 'v9' }).expect(400);
    await request(app).post('/api/live/token').send({ variant: 'fallback', apiVersion: 'v1alpha' }).expect(503);
  });

  test('unknown routes return JSON 404', async () => {
    const res = await request(app).get('/api/nope').expect(404);
    assert.match(res.body.error.message, /Route not found/);
  });
});
