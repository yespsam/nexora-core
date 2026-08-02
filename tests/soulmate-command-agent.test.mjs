import assert from 'node:assert/strict';
import test from 'node:test';

import { createSoulmateCloudIdentity } from '../shared/soulmate-cloud-sync.mjs';
import {
  getSoulmateCommandAgentStatus,
  loadSoulmateCommandAgent,
  queueSoulmateDeviceCommand,
  registerSoulmateCommandAgent
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
