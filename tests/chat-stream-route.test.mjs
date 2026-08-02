import assert from 'node:assert/strict';
import test from 'node:test';

import { createChatGrant } from '../netlify/functions/_shared/chat-grant.mjs';
import {
  config,
  createChatStreamHandler
} from '../netlify/functions/chat-stream.mjs';

const secret = 'test-fast-chat-signing-secret';
const payload = {
  text: '今天陪我聊一会儿。',
  client_release: 'signed-chat-route-v99',
  stream: true
};

function request(token = '', body = payload) {
  return new Request('https://private.test/api/chat/stream', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { 'X-Nexora-Chat-Grant': token } : {})
    },
    body: JSON.stringify(body)
  });
}

test('fast chat endpoint accepts only its signed release', async () => {
  let forwarded = null;
  const handler = createChatStreamHandler({
    secret,
    respond: async (value) => {
      forwarded = await value.json();
      return new Response('event: done\ndata: {}\n\n', {
        headers: { 'Content-Type': 'text/event-stream' }
      });
    }
  });
  const token = createChatGrant(payload.client_release, secret);
  const response = await handler(request(token));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'text/event-stream');
  assert.deepEqual(forwarded, payload);

  const changed = await handler(request(token, { ...payload, client_release: 'other-release-v99' }));
  assert.equal(changed.status, 401);
});

test('fast chat endpoint rejects missing grants before model work', async () => {
  let calls = 0;
  const handler = createChatStreamHandler({
    secret,
    respond: async () => {
      calls += 1;
      return new Response('unexpected');
    }
  });
  const response = await handler(request());
  assert.equal(response.status, 401);
  assert.equal(calls, 0);
  assert.deepEqual(await response.json(), { error: 'invalid_chat_grant' });
});

test('fast chat route remains bounded outside the product edge gate', () => {
  assert.equal(config.path, '/api/chat/stream');
  assert.deepEqual(config.method, ['POST']);
  assert.equal(config.rateLimit.windowLimit, 20);
  assert.deepEqual(config.rateLimit.aggregateBy, ['ip', 'domain']);
});
