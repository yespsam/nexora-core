import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  SOULMATE_CHAT_REQUEST_TIMEOUT_MS,
  SOULMATE_CHAT_RETRY_DELAYS_MS,
  canRetrySoulmateChat,
  removeUndeliveredSoulmateTurn,
  soulmateChatNetworkFailure,
  soulmateChatRetryDelay
} from '../shared/soulmate-resilience.mjs';

test('chat retries use a short bounded backoff and a finite request timeout', () => {
  assert.deepEqual(SOULMATE_CHAT_RETRY_DELAYS_MS, [650, 1800]);
  assert.deepEqual([0, 1, 8].map(soulmateChatRetryDelay), [650, 1800, 1800]);
  assert.equal(SOULMATE_CHAT_REQUEST_TIMEOUT_MS, 28000);
});

test('chat retries transient transport and upstream failures before a reply starts', () => {
  for (const status of [408, 425, 500, 502, 503, 504]) {
    assert.equal(canRetrySoulmateChat({ attempt: 0, status }), true, `status ${status}`);
  }
  for (const failure of [
    'client_network',
    'client_timeout',
    'request_failed',
    'server_key_network',
    'server_key_timeout',
    'server_key_provider',
    'gateway_failed'
  ]) {
    assert.equal(canRetrySoulmateChat({ attempt: 1, failure }), true, failure);
  }
});

test('chat never retries after partial speech, while offline, or after the retry budget', () => {
  const transient = { status: 503, failure: 'server_key_network' };
  assert.equal(canRetrySoulmateChat({ ...transient, partial: true }), false);
  assert.equal(canRetrySoulmateChat({ ...transient, online: false }), false);
  assert.equal(canRetrySoulmateChat({ ...transient, attempt: 2 }), false);
});

test('chat does not retry identity, quota, model, or invalid-response failures', () => {
  for (const failure of [
    'authentication_required',
    'server_key_auth',
    'server_key_quota',
    'server_key_rate_limit',
    'server_key_model',
    'server_key_invalid_response',
    'not_configured'
  ]) {
    assert.equal(canRetrySoulmateChat({ failure }), false, failure);
  }
  assert.equal(canRetrySoulmateChat({ status: 400 }), false);
  assert.equal(canRetrySoulmateChat({ status: 429 }), false);
});

test('chat transport errors preserve distinct offline, timeout, and network states', () => {
  assert.equal(soulmateChatNetworkFailure({ online: false }), 'client_offline');
  assert.equal(soulmateChatNetworkFailure({ timedOut: true }), 'client_timeout');
  assert.equal(soulmateChatNetworkFailure(), 'client_network');
});

test('an undelivered user turn is removed without touching earlier conversation', () => {
  const history = [
    { role: 'assistant', content: '我在听。' },
    { role: 'user', content: '  网络断了   再试试  ' }
  ];
  assert.deepEqual(removeUndeliveredSoulmateTurn(history, '网络断了 再试试'), [history[0]]);
  assert.equal(removeUndeliveredSoulmateTurn(history, '另一句话'), history);
  assert.equal(removeUndeliveredSoulmateTurn(null, '测试').length, 0);
});

test('pending chat and device turns stay local until a matching result is ready', async () => {
  const app = await readFile(new URL('../soulmate/app.js', import.meta.url), 'utf8');
  assert.equal(
    app.match(/appendMessage\('user', text, \{ persist: false \}\);/g)?.length,
    2
  );
  assert.match(app, /if \(persist\) saveHistory\(\);/);
});

test('ten thousand weak-network turns always stop within the retry budget', () => {
  for (let turn = 0; turn < 10000; turn += 1) {
    let attempts = 0;
    while (true) {
      const retry = canRetrySoulmateChat({
        attempt: attempts,
        status: turn % 2 ? 503 : 0,
        failure: turn % 2 ? 'server_key_provider' : 'client_network'
      });
      attempts += 1;
      if (!retry) break;
    }
    assert.equal(attempts, 3);
  }
});
