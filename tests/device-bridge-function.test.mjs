import assert from 'node:assert/strict';
import test from 'node:test';

import { createDeviceBridgeFunction } from '../netlify/functions/_shared/device-bridge-data.mjs';
import deployedHandler, { config } from '../netlify/functions/device-bridge.mjs';

const agentId = 'ef53f13f-b1a5-47ff-a759-171557c32e13';
const secret = 'S'.repeat(43);

function harness(overrides = {}) {
  const calls = [];
  const store = {
    async authenticateCommandAgent(...args) {
      calls.push({ method: 'authenticateCommandAgent', args });
      return { agentId, ownerId: 'owner', vaultId: 'A'.repeat(22), vaultUuid: 'vault' };
    },
    async claimCommand(...args) {
      calls.push({ method: 'claimCommand', args });
      return { command: null };
    },
    async acknowledgeCommand(...args) {
      calls.push({ method: 'acknowledgeCommand', args });
      return { status: 'acknowledged' };
    },
    ...overrides.store
  };
  return {
    calls,
    handler: createDeviceBridgeFunction({ enabled: true, getStore: () => store, ...overrides })
  };
}

function request(path, options = {}) {
  return new Request(`https://example.test${path}${path.includes('?') ? '&' : '?'}agentId=${agentId}`, {
    ...options,
    headers: { Authorization: `Bearer ${secret}`, ...(options.headers || {}) }
  });
}

test('device bridge remains disabled by default in deployed test environments', async () => {
  const response = await deployedHandler(request('/api/device-bridge/status'));
  assert.equal(response.status, 404);
});

test('bridge polling authenticates before atomically claiming work', async () => {
  const app = harness();
  const response = await app.handler(request('/api/device-bridge/commands'));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { command: null });
  assert.deepEqual(app.calls.map((call) => call.method), [
    'authenticateCommandAgent',
    'claimCommand'
  ]);
  assert.equal(app.calls[0].args[0], agentId);
  assert.equal(app.calls[0].args[1], secret);
});

test('bridge acknowledgements are bound to the authenticated agent', async () => {
  const app = harness();
  const commandId = '6245cdab-cd29-4f58-83ca-1f3b3c95d512';
  const response = await app.handler(request(`/api/device-bridge/commands/${commandId}/ack`, {
    method: 'POST',
    body: JSON.stringify({ outcome: 'acknowledged' })
  }));
  assert.equal(response.status, 200);
  assert.equal(app.calls[1].method, 'acknowledgeCommand');
  assert.equal(app.calls[1].args[1], commandId);
  assert.equal(app.calls[1].args[2], 'acknowledged');
});

test('bridge rejects missing bearer credentials before polling', async () => {
  const app = harness();
  const response = await app.handler(new Request(
    `https://example.test/api/device-bridge/commands?agentId=${agentId}`
  ));
  assert.equal(response.status, 401);
  assert.equal(app.calls.length, 0);
});

test('device bridge route is bounded independently from the private browser gate', () => {
  assert.equal(config.path, '/api/device-bridge/*');
  assert.deepEqual(config.method, ['GET', 'POST']);
  assert.equal(config.rateLimit.windowLimit, 180);
});
