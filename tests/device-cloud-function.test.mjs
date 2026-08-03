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
    registerCommandAgent: invoke('registerCommandAgent'),
    commandAgentStatus: invoke('commandAgentStatus'),
    revokeCommandAgent: invoke('revokeCommandAgent'),
    queueCommand: invoke('queueCommand'),
    commandStatus: invoke('commandStatus'),
    appendEvent: invoke('appendEvent'),
    listEvents: invoke('listEvents'),
    createSnapshot: invoke('createSnapshot'),
    latestSnapshot: invoke('latestSnapshot'),
    revokeDevice: invoke('revokeDevice'),
    recoverVaultEnvelope: invoke('recoverVaultEnvelope'),
    scheduleDeletion: invoke('scheduleDeletion'),
    cancelDeletion: invoke('cancelDeletion')
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

test('status exposes the separate dual-write gate without enabling it by default', async () => {
  const disabled = functionHarness();
  const disabledResponse = await disabled.handler(new Request('https://example.test/api/device-cloud/status'));
  assert.equal((await disabledResponse.json()).dualWrite, false);

  const enabled = functionHarness({ dualWriteEnabled: true });
  const enabledResponse = await enabled.handler(new Request('https://example.test/api/device-cloud/status'));
  assert.deepEqual(await enabledResponse.json(), {
    enabled: true,
    authenticated: true,
    dualWrite: true
  });
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

test('authenticated command routes stay owner-derived and return accepted work', async () => {
  const harness = functionHarness();
  const queued = await harness.handler(new Request('https://example.test/api/device-cloud/commands', {
    method: 'POST',
    headers: { Origin: 'https://example.test', 'Content-Type': 'application/json' },
    body: JSON.stringify({ encrypted: true })
  }));
  assert.equal(queued.status, 202);
  assert.equal(harness.calls[0].method, 'queueCommand');
  assert.equal(harness.calls[0].args[0], ownerIdForExternalSubject(`netlify-identity:${userId}`, pepper));

  const commandId = 'ef53f13f-b1a5-47ff-a759-171557c32e13';
  const status = await harness.handler(new Request(`https://example.test/api/device-cloud/commands/${commandId}`));
  assert.equal(status.status, 200);
  assert.equal(harness.calls[1].method, 'commandStatus');
  assert.equal(harness.calls[1].args[1], commandId);
});

test('command agent revocation is same-origin, owner-derived, and scoped to its vault', async () => {
  const harness = functionHarness();
  const agentId = 'ef53f13f-b1a5-47ff-a759-171557c32e13';
  const vaultId = 'A'.repeat(22);
  const response = await harness.handler(new Request(
    `https://example.test/api/device-cloud/command-agents/${agentId}/revoke`,
    {
      method: 'POST',
      headers: { Origin: 'https://example.test', 'Content-Type': 'application/json' },
      body: JSON.stringify({ vaultId })
    }
  ));
  assert.equal(response.status, 200);
  assert.equal(harness.originChecks(), 1);
  assert.equal(harness.calls[0].method, 'revokeCommandAgent');
  assert.equal(
    harness.calls[0].args[0],
    ownerIdForExternalSubject(`netlify-identity:${userId}`, pepper)
  );
  assert.deepEqual(harness.calls[0].args[1], { agentId, vaultId });
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

test('snapshot endpoints pass only authenticated ownership and the configured object adapter', async () => {
  const objects = { put() {}, get() {} };
  const harness = functionHarness({
    getSnapshotObjects: () => objects,
    getSnapshotNamespace: () => 'branch-test'
  });
  const saved = await harness.handler(new Request('https://example.test/api/device-cloud/snapshots', {
    method: 'POST',
    headers: { Origin: 'https://example.test' },
    body: JSON.stringify({ vaultId: 'A'.repeat(22) })
  }));
  assert.equal(saved.status, 201);
  assert.equal(harness.calls[0].method, 'createSnapshot');
  assert.equal(harness.calls[0].args[2].objects, objects);
  assert.equal(harness.calls[0].args[2].namespace, 'branch-test');

  const latest = await harness.handler(new Request(
    `https://example.test/api/device-cloud/snapshots/latest?vaultId=${'A'.repeat(22)}&deviceId=ef53f13f-b1a5-47ff-a759-171557c32e13`
  ));
  assert.equal(latest.status, 200);
  assert.equal(harness.calls[1].method, 'latestSnapshot');
  assert.equal(harness.calls[1].args[1].requesterDeviceId, 'ef53f13f-b1a5-47ff-a759-171557c32e13');
});

test('deletion cancellation stays owner-derived and requires a same-origin write', async () => {
  const harness = functionHarness();
  const requestId = 'ef53f13f-b1a5-47ff-a759-171557c32e13';
  const response = await harness.handler(new Request(
    `https://example.test/api/device-cloud/deletions/${requestId}/cancel`,
    { method: 'POST', headers: { Origin: 'https://example.test' }, body: '{}' }
  ));
  assert.equal(response.status, 200);
  assert.equal(harness.calls[0].method, 'cancelDeletion');
  assert.equal(harness.calls[0].args[1], requestId);
});

test('Netlify route is private, rate-limited, and restricted to read/write methods', () => {
  assert.equal(config.path, '/api/device-cloud/*');
  assert.deepEqual(config.method, ['GET', 'POST']);
  assert.equal(config.rateLimit.windowLimit, 300);
});
