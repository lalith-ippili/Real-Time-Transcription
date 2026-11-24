// Verifies the token request and the wire setup for both model variants,
// with Google's API mocked (no network).
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';

const calls = [];
const realFetch = globalThis.fetch;
let service;

before(async () => {
  process.env.GEMINI_API_KEY = 'AQ.test-key';
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(init.body) });
    return new Response(JSON.stringify({ name: 'auth_tokens/test' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  service = await import('../src/services/geminiLive.service.js');
});

after(() => {
  globalThis.fetch = realFetch;
});

test('primary variant uses the transcription model with TEXT output and no system prompt', async () => {
  const s = await service.createLiveToken();
  assert.equal(s.token, 'auth_tokens/test');
  assert.equal(s.model, 'gemini-3.5-transcribe-live');
  assert.equal(s.mode, 'transcribe');
  assert.equal(s.apiVersion, 'v1beta');
  assert.deepEqual(s.setup.generationConfig.responseModalities, ['TEXT']);
  assert.deepEqual(s.setup.inputAudioTranscription, {});
  assert.equal(s.setup.systemInstruction, undefined);
  assert.equal(s.setup.model, 'models/gemini-3.5-transcribe-live');

  const req = calls.at(-1);
  assert.match(req.url, /\/v1beta\/auth_tokens$/);
  assert.equal(req.body.uses, 1);
  assert.equal(req.body.bidiGenerateContentSetup.model, 'models/gemini-3.5-transcribe-live');
});

test('fallback variant uses the conversational model with AUDIO output and a silent-listener prompt', async () => {
  const s = await service.createLiveToken({ variant: 'fallback', apiVersion: 'v1alpha' });
  assert.equal(s.model, 'gemini-3.1-flash-live-preview');
  assert.equal(s.mode, 'agent');
  assert.equal(s.apiVersion, 'v1alpha');
  assert.deepEqual(s.setup.generationConfig.responseModalities, ['AUDIO']);
  assert.ok(s.setup.systemInstruction.parts[0].text.includes('dictation'));
  assert.match(calls.at(-1).url, /\/v1alpha\/auth_tokens$/);
});
