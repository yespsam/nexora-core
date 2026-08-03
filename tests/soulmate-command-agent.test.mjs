import assert from 'node:assert/strict';
import test from 'node:test';

import { createSoulmateCloudIdentity } from '../shared/soulmate-cloud-sync.mjs';
import {
  clearSoulmateCommandAgent,
  getSoulmateCommandAgentStatus,
  loadSoulmateCommandAgent,
  mergeSoulmateCommandAgentStatus,
  queueSoulmateDeviceCommand,
  registerSoulmateCommandAgent,
  revokeSoulmateCommandAgent
} from '../shared/soulmate-command-agent.mjs';
import { parseDeviceCommand } from '../shared/device-command.mjs';

function memoryStorage() {
  const values = new Map();
  return {
    values,
    get: async (key) => values.get(key),
    put: async (key, value) => values.set(key, structuredClone(value)),
    delete: async (key) => values.delete(key)
  };
}

test('browser pairing stores the desktop secret encrypted at rest', async () => {
  const identity = createSoulmateCloudIdentity();
  const storage = memoryStorage();
  const requests = [];
  const fetchImpl = async (url, options = {}) => {
    requests.push({ url, body: options.body ? JSON.parse(options.body) : null });
    return Response.json({ status: 'active' }, { status: 201 });
  };
  const paired = await registerSoulmateCommandAgent(identity, { storage, fetchImpl });
  assert.equal(requests[0].url, '/api/device-cloud/command-agents');
  assert.equal('secret' in requests[0].body, false);
  assert.deepEqual(await loadSoulmateCommandAgent(identity, { storage }), paired.credential);
  assert.equal(JSON.stringify([...storage.values.values()]).includes(paired.credential.secret), false);
});

test('browser queues ciphertext and reads agent status without sending its secret', async () => {
  const identity = createSoulmateCloudIdentity();
  const storage = memoryStorage();
  const requests = [];
  const fetchImpl = async (url, options = {}) => {
    const body = options.body ? JSON.parse(options.body) : null;
    requests.push({ url, body });
    return Response.json(url.includes('command-agents/')
      ? { status: 'active', lastSeenAt: null }
      : { commandId: crypto.randomUUID(), status: 'queued' });
  };
  const paired = await registerSoulmateCommandAgent(identity, { storage, fetchImpl });
  requests.length = 0;
  const queued = await queueSoulmateDeviceCommand(
    parseDeviceCommand('把电脑音量调到35'),
    identity,
    paired.credential,
    { fetchImpl }
  );
  assert.equal(queued.status, 'queued');
  assert.equal(requests[0].body.payload.algorithm, 'A256GCM');
  assert.equal(JSON.stringify(requests[0]).includes(paired.credential.secret), false);
  const status = await getSoulmateCommandAgentStatus(identity, paired.credential, { fetchImpl });
  assert.equal(status.status, 'active');
});

test('browser revokes the remote agent and removes its encrypted local credential', async () => {
  const identity = createSoulmateCloudIdentity();
  const storage = memoryStorage();
  const requests = [];
  const fetchImpl = async (url, options = {}) => {
    requests.push({
      url,
      method: options.method || 'GET',
      body: options.body ? JSON.parse(options.body) : null
    });
    return Response.json({ status: url.endsWith('/revoke') ? 'revoked' : 'active' });
  };
  const paired = await registerSoulmateCommandAgent(identity, { storage, fetchImpl });
  requests.length = 0;
  const result = await revokeSoulmateCommandAgent(identity, paired.credential, { storage, fetchImpl });
  assert.equal(result.status, 'revoked');
  assert.equal(
    requests[0].url,
    `/api/device-cloud/command-agents/${paired.credential.agentId}/revoke`
  );
  assert.equal(requests[0].method, 'POST');
  assert.deepEqual(requests[0].body, { vaultId: identity.syncId });
  assert.equal(JSON.stringify(requests[0]).includes(paired.credential.secret), false);
  assert.equal(await loadSoulmateCommandAgent(identity, { storage }), null);
  assert.equal(await clearSoulmateCommandAgent(identity, { storage }), true);
});

test('a recent command acknowledgement survives a stale agent status response', () => {
  const acknowledgedAt = '2026-08-02T12:00:00.000Z';
  assert.deepEqual(
    mergeSoulmateCommandAgentStatus(
      { status: 'active', lastSeenAt: acknowledgedAt },
      { status: 'active', lastSeenAt: null }
    ),
    { status: 'active', lastSeenAt: acknowledgedAt }
  );
  assert.equal(
    mergeSoulmateCommandAgentStatus(
      { lastSeenAt: acknowledgedAt },
      { lastSeenAt: '2026-08-02T12:01:00.000Z' }
    ).lastSeenAt,
    '2026-08-02T12:01:00.000Z'
  );
});
