/**
 * Gemini Live relay – WebSocket at /api/live/stream.
 *
 * The browser streams microphone audio to this server, and the server talks to
 * the Gemini Live API with the secret API key (the standard, documented
 * connection). Transcription events are passed straight back to the browser.
 *
 *   browser ──(realtimeInput: audio)──▶ relay ──▶ Gemini Live
 *   browser ◀──(serverContent: text)── relay ◀── Gemini Live
 *
 * Security: allowed origins only, per-IP rate and concurrency limits, the
 * session setup (model, config) is always built here – the browser can only
 * pick the variant and a language hint – and only `realtimeInput` messages are
 * forwarded upstream.
 *
 * Needs a long-running server (Render, local `npm run dev`). Serverless hosts
 * such as Vercel can't hold WebSockets; there the browser falls back to the
 * ephemeral-token connection.
 */
import { WebSocket, WebSocketServer } from 'ws';
import config from '../config/env.js';
import { buildOriginMatcher } from '../utils/cors.js';
import { liveSetupFor } from '../services/geminiLive.service.js';

export const RELAY_PATH = '/api/live/stream';

const MAX_PER_MINUTE = Math.max(5, config.rateLimit.tokenMax);
const MAX_CONCURRENT_PER_IP = 4;
const MAX_QUEUED_MESSAGES = 300; // ≈30 s of audio while Gemini connects
const PING_EVERY_MS = 25_000;

let enabled = false;
export const isRelayEnabled = () => enabled && Boolean(config.gemini.apiKey);

const log = (...args) => {
  if (!config.isTest) console.log('[relay]', ...args);
};

const clientIp = (req) =>
  String(req.headers['x-forwarded-for'] || '')
    .split(',')[0]
    .trim() || req.socket.remoteAddress;

// WebSocket close codes the browser is allowed to receive.
const safeCode = (code) => (code === 1000 || (code >= 3000 && code <= 4999) ? code : 1011);
const safeReason = (reason) => Buffer.from(String(reason || '')).subarray(0, 120).toString();

export function attachLiveRelay(server) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 });
  const isAllowedOrigin = buildOriginMatcher(config.corsOrigins);
  const usage = new Map(); // ip → { windowStart, count, open }

  const reject = (socket, status, text) => {
    socket.write(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
    socket.destroy();
  };

  server.on('upgrade', (req, socket, head) => {
    let url;
    try {
      url = new URL(req.url, 'http://localhost');
    } catch {
      return reject(socket, 400, 'Bad Request');
    }
    if (url.pathname !== RELAY_PATH) return reject(socket, 404, 'Not Found');
    if (!config.gemini.apiKey) return reject(socket, 503, 'Service Unavailable');

    const origin = req.headers.origin;
    if (origin && !isAllowedOrigin(origin)) {
      log(`rejected origin ${origin}`);
      return reject(socket, 403, 'Forbidden');
    }

    const ip = clientIp(req);
    const now = Date.now();
    const entry = usage.get(ip) || { windowStart: now, count: 0, open: 0 };
    if (now - entry.windowStart > 60_000) {
      entry.windowStart = now;
      entry.count = 0;
    }
    if (entry.count >= MAX_PER_MINUTE || entry.open >= MAX_CONCURRENT_PER_IP) {
      return reject(socket, 429, 'Too Many Requests');
    }
    entry.count += 1;
    entry.open += 1;
    usage.set(ip, entry);

    wss.handleUpgrade(req, socket, head, (client) => {
      client.on('close', () => {
        entry.open = Math.max(0, entry.open - 1);
      });
      handleClient(client, url);
    });
  });

  enabled = true;
  log(`Gemini Live relay ready on ${RELAY_PATH}`);
  return wss;
}

function handleClient(client, url) {
  const variant = url.searchParams.get('variant') === 'fallback' ? 'fallback' : 'primary';
  const lang = ['english', 'hindi'].includes(url.searchParams.get('lang')) ? url.searchParams.get('lang') : null;
  const { model, mode, setup } = liveSetupFor(variant, lang);
  log(`client connected → ${model}${lang ? ` (${lang})` : ''}`);

  // Tell the browser which model/mode it is talking to (not a Gemini message).
  client.send(JSON.stringify({ relay: { model, mode, language: lang } }));

  const apiKey = config.gemini.apiKey;
  const upstream = new WebSocket(`${config.gemini.wsUrl}?key=${encodeURIComponent(apiKey)}`, {
    headers: { 'x-goog-api-key': apiKey },
  });

  const queue = [];
  let closed = false;

  const closeClient = (code, reason) => {
    if (closed) return;
    closed = true;
    clearInterval(ping);
    try {
      client.close(safeCode(code), safeReason(reason));
    } catch {
      client.terminate();
    }
    if (upstream.readyState === WebSocket.OPEN || upstream.readyState === WebSocket.CONNECTING) {
      upstream.terminate();
    }
  };

  const ping = setInterval(() => {
    if (client.readyState === WebSocket.OPEN) client.ping();
  }, PING_EVERY_MS);

  upstream.on('open', () => {
    upstream.send(JSON.stringify({ setup }));
    while (queue.length) upstream.send(queue.shift());
  });

  upstream.on('message', (data, isBinary) => {
    if (client.readyState !== WebSocket.OPEN) return;
    const text = isBinary || Buffer.isBuffer(data) ? Buffer.from(data).toString('utf8') : String(data);
    client.send(text); // forwarded as a text frame
  });

  upstream.on('unexpected-response', (_req, res) => {
    log(`Gemini refused the connection: HTTP ${res.statusCode}`);
    closeClient(4000 + Math.min(res.statusCode, 999), `Gemini refused the connection (HTTP ${res.statusCode})`);
  });

  upstream.on('error', (err) => {
    log(`upstream error: ${err.message}`);
    closeClient(1011, `Gemini connection error: ${err.message}`);
  });

  upstream.on('close', (code, reasonBuffer) => {
    const reason = reasonBuffer?.toString() || '';
    log(`Gemini closed (${code})${reason ? `: ${reason}` : ''}`);
    closeClient(code === 1000 ? 1000 : 4000 + (code % 1000), reason || `Gemini closed the session (code ${code})`);
  });

  client.on('message', (data) => {
    let message;
    try {
      message = JSON.parse(data.toString());
    } catch {
      return;
    }
    // Only audio (and the end-of-audio signal) ever goes upstream.
    const input = message?.realtimeInput;
    if (!input || !(input.audio || input.audioStreamEnd)) return;
    const payload = JSON.stringify({
      realtimeInput: input.audio
        ? { audio: { data: String(input.audio.data || ''), mimeType: 'audio/pcm;rate=16000' } }
        : { audioStreamEnd: true },
    });
    if (upstream.readyState === WebSocket.OPEN) upstream.send(payload);
    else if (upstream.readyState === WebSocket.CONNECTING && queue.length < MAX_QUEUED_MESSAGES) queue.push(payload);
  });

  client.on('close', () => {
    closed = true;
    clearInterval(ping);
    if (upstream.readyState === WebSocket.OPEN) upstream.close(1000);
    else if (upstream.readyState === WebSocket.CONNECTING) upstream.terminate();
  });

  client.on('error', () => client.terminate());
}
