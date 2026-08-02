import assert from 'node:assert/strict';
import test from 'node:test';

import {
  cleanChatGrantRelease,
  createChatGrant,
  verifyChatGrant
} from '../netlify/functions/_shared/chat-grant.mjs';

const secret = 'test-chat-signing-secret-with-enough-length';
const release = 'signed-chat-route-v99';

test('chat grants bind an in-memory token to one release', () => {
  const now = Date.UTC(2026, 7, 2, 8, 0, 0);
  const token = createChatGrant(release, secret, { now, ttlMs: 480_000 });
  assert.match(token, /^ncg1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  assert.equal(verifyChatGrant(token, release, secret, { now: now + 240_000 }), true);
  assert.equal(verifyChatGrant(token, release, secret, { now: now + 481_000 }), false);
  assert.equal(verifyChatGrant(token, 'different-release-v99', secret, { now }), false);
});

test('chat grants reject tampering, weak secrets, and unsafe releases', () => {
  const now = Date.UTC(2026, 7, 2, 8, 0, 0);
  const token = createChatGrant(release, secret, { now });
  const replacement = token.endsWith('A') ? 'B' : 'A';
  const tampered = `${token.slice(0, -1)}${replacement}`;
  assert.equal(verifyChatGrant(tampered, release, secret, { now }), false);
  assert.equal(createChatGrant(release, 'short', { now }), '');
  assert.equal(cleanChatGrantRelease('../../admin'), '');
});
