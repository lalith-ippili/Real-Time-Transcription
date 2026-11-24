// End-to-end test of the Gemini Live relay against a fake Gemini server.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';

let fake; // fake Gemini Live endpoint
let server; // our API with the relay attached
let relayUrl;
const upstreamLog = [];
let upstreamBehaviour = 'normal';

before(async () => {
  fake = new WebSocketServer({ port: 0 });
  await new Promise((r) => fake.on('listening', r));
  fake.on('connection', (ws, req) => {
    upstreamLog.push({ type: 'connect', url: req.url, keyHeader: req.headers['x-goog-api-key'] });
    if (upstreamBehaviour === 'reject-model') {
      ws.on('message', () => ws.close(1008, 'models/x is not found'));
      return;
    }
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      upstreamLog.push({ type: 'message', msg });
      if (msg.setup) ws.send(JSON.stringify({ setupComplete: {} }));
      if (msg.realtimeInput?.audio) {
        ws.send(Buffer.from(JSON.stringify({ serverContent: { interimInputTranscription: { text: 'नमस्ते' } } })));
        ws.send(JSON.stringify({ serverContent: { inputTranscription: { text: 'नमस्ते everyone.' } } }));
      }
    });
  });

  process.env.NODE_ENV = 'test';
  process.env.GEMINI_API_KEY = 'AQ.test-key';
  process.env.GEMINI_WS_URL = `ws://127.0.0.1:${fake.address().port}/ws`;
  process.env.CORS_ORIGIN = 'http://allowed.test';
  process.env.DATABASE_URL = '';

  const app = (await import('../src/app.js')).default;
  const { attachLiveRelay } = await import('../src/live/relay.js');
  server = http.createServer(app);
  attachLiveRelay(server);
  await new Promise((r) => server.listen(0, r));
  relayUrl = `ws://127.0.0.1:${server.address().port}/api/live/stream`;
});

after(async () => {
  server?.close();
  fake?.close();
});

const open = (query = '', origin = 'http://allowed.test') =>
  new Promise((resolve, reject) => {
    const ws = new WebSocket(`${relayUrl}${query}`, { headers: { origin } });
    const messages = [];
    ws.on('message', (d) => messages.push(JSON.parse(d.toString())));
    ws.on('open', () => resolve({ ws, messages }));
    ws.on('unexpected-response', (_req, res) => reject(new Error(`HTTP ${res.statusCode}`)));
    ws.on('error', reject);
  });

const waitFor = async (check, ms = 2000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (check()) return true;
    await new Promise((r) => setTimeout(r, 20));
  }
  return false;
};

test('relays audio up and transcripts down, with a server-built setup', async () => {
  upstreamLog.length = 0;
  const { ws, messages } = await open();
  // A client trying to choose its own model must be ignored.
  ws.send(JSON.stringify({ setup: { model: 'models/something-expensive' } }));
  ws.send(JSON.stringify({ clientContent: { turns: 'ignore me' } }));
  ws.send(JSON.stringify({ realtimeInput: { audio: { data: 'AAAA', mimeType: 'audio/pcm;rate=16000' } } }));

  assert.ok(await waitFor(() => messages.some((m) => m.serverContent?.inputTranscription)));
  assert.equal(messages[0].relay.model, 'gemini-3.5-transcribe-live');
  assert.equal(messages[0].relay.mode, 'transcribe');
  assert.ok(messages.some((m) => m.setupComplete));
  assert.equal(messages.find((m) => m.serverContent?.interimInputTranscription).serverContent.interimInputTranscription.text, 'नमस्ते');

  const connect = upstreamLog.find((e) => e.type === 'connect');
  assert.equal(connect.keyHeader, 'AQ.test-key');
  assert.match(connect.url, /key=AQ\.test-key/);
  const sent = upstreamLog.filter((e) => e.type === 'message').map((e) => e.msg);
  assert.equal(sent[0].setup.model, 'models/gemini-3.5-transcribe-live');
  assert.deepEqual(sent[0].setup.generationConfig.responseModalities, ['TEXT']);
  assert.equal(sent.filter((m) => m.setup).length, 1, 'client setup is not forwarded');
  assert.ok(!sent.some((m) => m.clientContent), 'non-audio messages are not forwarded');
  assert.equal(sent.find((m) => m.realtimeInput).realtimeInput.audio.data, 'AAAA');
  ws.close();
});

test('language hint and fallback variant are applied server-side', async () => {
  upstreamLog.length = 0;
  const a = await open('?variant=primary&lang=english');
  await waitFor(() => upstreamLog.some((e) => e.msg?.setup));
  assert.deepEqual(upstreamLog.find((e) => e.msg?.setup).msg.setup.inputAudioTranscription.languageCodes, ['en-IN']);
  a.ws.close();

  upstreamLog.length = 0;
  const b = await open('?variant=fallback');
  await waitFor(() => upstreamLog.some((e) => e.msg?.setup));
  assert.equal(upstreamLog.find((e) => e.msg?.setup).msg.setup.model, 'models/gemini-3.1-flash-live-preview');
  assert.equal(b.messages[0].relay.mode, 'agent');
  b.ws.close();
});

test('rejects other origins', async () => {
  await assert.rejects(open('', 'https://evil.example'), /HTTP 403/);
});

test('passes Gemini errors on to the browser as a close reason', async () => {
  upstreamBehaviour = 'reject-model';
  const { ws } = await open();
  const closed = new Promise((r) => ws.on('close', (code, reason) => r({ code, reason: reason.toString() })));
  const { code, reason } = await closed;
  assert.ok(code >= 4000);
  assert.match(reason, /not found/);
  upstreamBehaviour = 'normal';
});

test('health reports the relay as available', async () => {
  const res = await fetch(`http://127.0.0.1:${server.address().port}/api/health`);
  const body = await res.json();
  assert.equal(body.engines.geminiLive.relay, true);
});
