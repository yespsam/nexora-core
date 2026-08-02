import assert from 'node:assert/strict';
import test from 'node:test';

import {
  cleanVoiceGrantScope,
  createVoiceGrant,
  verifyVoiceGrant
} from '../netlify/functions/_shared/voice-grant.mjs';

const secret = 'test-signing-secret-with-enough-length';
const scope = {
  persona: 'creature:cute',
  archetype: 'sprout',
  starter: 'cute'
};

test('voice grants bind a short-lived token to one cast', () => {
  const now = Date.UTC(2026, 7, 2, 8, 0, 0);
  const token = createVoiceGrant(scope, secret, { now, ttlMs: 45_000 });
  assert.match(token, /^nvg1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  assert.equal(verifyVoiceGrant(token, scope, secret, { now: now + 20_000 }), true);
  assert.equal(verifyVoiceGrant(token, scope, secret, { now: now + 46_000 }), false);
  assert.equal(verifyVoiceGrant(token, { ...scope, archetype: 'edge' }, secret, { now }), false);
});

test('voice grants reject tampering, weak secrets, and unknown casts', () => {
  const now = Date.UTC(2026, 7, 2, 8, 0, 0);
  const token = createVoiceGrant(scope, secret, { now });
  const replacement = token.endsWith('A') ? 'B' : 'A';
  const tampered = `${token.slice(0, -1)}${replacement}`;
  assert.equal(verifyVoiceGrant(tampered, scope, secret, { now }), false);
  assert.equal(createVoiceGrant(scope, 'short', { now }), '');
  assert.equal(cleanVoiceGrantScope({ ...scope, archetype: 'admin' }), null);
});
