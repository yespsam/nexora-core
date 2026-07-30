import assert from 'node:assert/strict';
import test from 'node:test';

import { ownerIdForExternalSubject } from '../cloud/device-cloud-identity.mjs';
import { createDeviceCloudFunction } from '../netlify/functions/_shared/device-cloud-data.mjs';
import deployedHandler, { config } from '../netlify/functions/device-cloud.mjs';

const pepper = 'S'.repeat(43);
const userId = '7aa47f0a-0c8f-4a40-bb73-97fb54d5a480';

function fakeStore(calls) {
  const invoke = (method) => async (...args) => {
    calls.push({ method, args });
    return { method };
  };
  return {
    bootstrap: invoke('bootstrap'),
    registerDevice: invoke('registerDevice'),
    appendEvent: invoke('appendEvent'),
    listEvents: invoke('listEvents'),
    revokeDevice: invoke('revokeDevice'),
    recoverVaultEnvelope: invoke('recoverVaultEnvelope'),
    scheduleDeletion: invoke('scheduleDeletion')
  };
}

function functionHarness(overrides = {}) {
  const calls = [];
  let originChecks = 0;
  const store = fakeStore(calls);
  const handler = createDeviceCloudFunction({
    enabled: true,
    getStore: () => store,
    getCurrentUser: async () => ({ id: userId }),
    verifyOrigin: () => { originChecks += 1; },
    subjectPepper: pepper,
    ...overrides
  });
  return { calls, handler, originChecks: () => originChecks };
}

test('device cloud function stays undiscoverable while the staging flag is disabled', async () => {
  let authCalls = 0;
  const handler = createDeviceCloudFunction({
    enabled: false,
    getStore: () => { throw new Error('must not connect'); },
    getCurrentUser: async () => { authCalls += 1; },
    verifyOrigin: () => {},
    subjectPepper: ''
  });
  const response = await handler(new Request('https://example.test/api/device-cloud/status'));
  assert.equal(response.status, 404);
  assert.equal(authCalls, 0);
});

test('deployed handler is disabled by default in the current production environment', async () => {
  const response = await deployedHandler(new Request('https://example.test/api/device-cloud/status'));
  assert.equal(response.status, 404);
});

test('device cloud function requires an authenticated Netlify Identity user', async () => {
  const harness = functionHarness({ getCurrentUser: async () => null });
  const response = await harness.handler(new Request('https://example.test/api/device-cloud/status'));
  assert.equal(response.status, 401);
  assert.equal(harness.calls.length, 0);
});

test('bootstrap derives the RLS owner from Identity and ignores client identity fields', async () => {
  const harness = functionHarness();
  const response = await harness.handler(new Request('https://example.test/api/device-cloud/bootstrap', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://example.test' },
    body: JSON.stringify({ vaultId: 'A'.repeat(22), externalSubject: 'attacker-controlled' })
  }));
  assert.equal(response.status, 201);
  assert.equal(harness.originChecks(), 1);
  assert.equal(harness.calls[0].method, 'bootstrap');
  assert.equal(
    harness.calls[0].args[0],
    ownerIdForExternalSubject(`netlify-identity:${userId}`, pepper)
  );
  assert.equal(harness.calls[0].args[1].externalSubject, `netlify-identity:${userId}`);
});

test('state-changing requests fail closed when same-origin verification fails', async () => {
  const harness = functionHarness({ verifyOrigin: () => { throw new Error('bad origin'); } });
  const response = await harness.handler(new Request('https://example.test/api/device-cloud/events', {
    method: 'POST',
    body: '{}'
  }));
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error, 'invalid_origin');
  assert.equal(harness.calls.length, 0);
});

test('event reads require server-derived ownership and an explicit requester device', async () => {
  const harness = functionHarness();
  const response = await harness.handler(new Request(
    `https://example.test/api/device-cloud/events?vaultId=${'A'.repeat(22)}&deviceId=ef53f13f-b1a5-47ff-a759-171557c32e13&after=9&limit=25`,
    { headers: { 'X-Nexora-Owner-Id': '00000000-0000-0000-0000-000000000000' } }
  ));
  assert.equal(response.status, 200);
  assert.equal(harness.calls[0].method, 'listEvents');
  assert.equal(harness.calls[0].args[1].after, 9);
  assert.equal(harness.calls[0].args[1].limit, 25);
  assert.notEqual(harness.calls[0].args[0], '00000000-0000-0000-0000-000000000000');
});

test('cloud deletion endpoint always enforces the retention window', async () => {
  const harness = functionHarness();
  const response = await harness.handler(new Request('https://example.test/api/device-cloud/deletions', {
    method: 'POST',
    headers: { Origin: 'https://example.test' },
    body: JSON.stringify({ scope: 'account', immediate: true })
  }));
  assert.equal(response.status, 202);
  assert.equal(harness.calls[0].method, 'scheduleDeletion');
  assert.equal(harness.calls[0].args[1].immediate, false);
});

test('Netlify route is private, rate-limited, and restricted to read/write methods', () => {
  assert.equal(config.path, '/api/device-cloud/*');
  assert.deepEqual(config.method, ['GET', 'POST']);
  assert.equal(config.rateLimit.windowLimit, 300);
});
