import assert from 'node:assert/strict';
import test from 'node:test';

import { createVoiceGrant } from '../netlify/functions/_shared/voice-grant.mjs';
import {
  config,
  createVoiceStreamHandler
} from '../netlify/functions/voice-stream.mjs';

const secret = 'test-fast-voice-signing-secret';
const payload = {
  text: '你好。',
  persona: 'creature:cute',
  archetype: 'sprout',
  starter: 'cute',
  mood: 'calm'
};

function request(token = '', body = payload) {
  return new Request('https://private.test/api/voice/stream', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { 'X-Nexora-Voice-Grant': token } : {})
    },
    body: JSON.stringify(body)
  });
}

test('fast voice endpoint accepts only a matching signed cast', async () => {
  let forwarded = null;
  const handler = createVoiceStreamHandler({
    secret,
    respond: async (value) => {
      forwarded = value;
      return new Response('audio', { headers: { 'Content-Type': 'audio/mpeg' } });
    }
  });
  const token = createVoiceGrant(payload, secret);
  const response = await handler(request(token));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'audio/mpeg');
  assert.deepEqual(forwarded, payload);

  const changed = await handler(request(token, { ...payload, archetype: 'edge' }));
  assert.equal(changed.status, 401);
  assert.deepEqual(await changed.json(), { error: 'invalid_voice_grant' });
});

test('fast voice endpoint rejects requests without a grant before synthesis', async () => {
  let calls = 0;
  const handler = createVoiceStreamHandler({
    secret,
    respond: async () => {
      calls += 1;
      return new Response('audio');
    }
  });
  const response = await handler(request());
  assert.equal(response.status, 401);
  assert.equal(calls, 0);
  assert.match(response.headers.get('cache-control'), /no-store/);
});

test('fast voice route remains bounded when excluded from the product gate', () => {
  assert.equal(config.path, '/api/voice/stream');
  assert.deepEqual(config.method, ['POST']);
  assert.equal(config.rateLimit.windowLimit, 40);
  assert.deepEqual(config.rateLimit.aggregateBy, ['ip', 'domain']);
});
