import assert from 'node:assert/strict';
import test from 'node:test';

import { createDeviceCommandAgentCredential } from '../shared/device-command-cloud.mjs';
import { fromBase64Url, toBase64Url } from '../shared/device-cloud-crypto.mjs';
import { createSoulmateCloudIdentity } from '../shared/soulmate-cloud-sync.mjs';
import {
  clearSoulmateCommandAgent,
  getSoulmateCommandAgentStatus,
  listSoulmateCommandAgentStatuses,
  loadSoulmateCommandAgent,
  loadSoulmateCommandAgents,
  mergeSoulmateCommandAgentStatus,
  queueSoulmateDeviceCommand,
  registerSoulmateCommandAgent,
  saveSoulmateCommandAgent,
  revokeSoulmateCommandAgent,
  revokeSoulmateCommandAgentById,
  selectSoulmateCommandAgent
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

async function saveLegacyAgentState(storage, identity, credential) {
  const material = await crypto.subtle.importKey(
    'raw',
    fromBase64Url(identity.encryptionKey, 32, 32),
    'HKDF',
    false,
    ['deriveKey']
  );
  const key = await crypto.subtle.deriveKey({
    name: 'HKDF',
    hash: 'SHA-256',
    salt: new TextEncoder().encode('nexora-command-agent-storage-v1'),
    info: new TextEncoder().encode(identity.syncId)
  }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({
    name: 'AES-GCM',
    iv,
    additionalData: new TextEncoder().encode(`nexora-command-agent-state-v1:${identity.syncId}`),
    tagLength: 128
  }, key, new TextEncoder().encode(JSON.stringify(credential)));
  await storage.put(`command-agent:${identity.syncId}`, {
    version: 1,
    vaultId: identity.syncId,
    iv: toBase64Url(iv),
    ciphertext: toBase64Url(ciphertext)
  });
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

test('legacy single-agent ciphertext migrates without losing the existing computer', async () => {
  const identity = createSoulmateCloudIdentity();
  const storage = memoryStorage();
  const legacy = await createDeviceCommandAgentCredential(identity.syncId, {
    displayName: 'Existing Mac'
  });
  await saveLegacyAgentState(storage, identity, legacy.credential);
  assert.equal((await loadSoulmateCommandAgent(identity, { storage })).agentId, legacy.credential.agentId);

  const added = await createDeviceCommandAgentCredential(identity.syncId, {
    displayName: 'New PC'
  });
  await saveSoulmateCommandAgent(identity, added.credential, { storage });
  assert.deepEqual(
    (await loadSoulmateCommandAgents(identity, { storage })).map((item) => item.displayName),
    ['Existing Mac', 'New PC']
  );
  assert.equal([...storage.values.values()][0].version, 2);
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

test('browser stores, selects, and individually revokes multiple encrypted desktop agents', async () => {
  const identity = createSoulmateCloudIdentity();
  const storage = memoryStorage();
  const requests = [];
  const fetchImpl = async (url, options = {}) => {
    requests.push({ url, method: options.method || 'GET' });
    return Response.json({ status: url.endsWith('/revoke') ? 'revoked' : 'active' }, {
      status: options.method === 'POST' && url.endsWith('command-agents') ? 201 : 200
    });
  };
  const first = await registerSoulmateCommandAgent(identity, {
    storage,
    fetchImpl,
    displayName: 'Studio Mac'
  });
  const second = await registerSoulmateCommandAgent(identity, {
    storage,
    fetchImpl,
    displayName: 'Travel PC'
  });
  assert.deepEqual(
    (await loadSoulmateCommandAgents(identity, { storage })).map((item) => item.displayName),
    ['Studio Mac', 'Travel PC']
  );
  assert.equal((await loadSoulmateCommandAgent(identity, { storage })).agentId, second.credential.agentId);
  await selectSoulmateCommandAgent(identity, first.credential.agentId, { storage });
  assert.equal((await loadSoulmateCommandAgent(identity, { storage })).agentId, first.credential.agentId);
  assert.equal(JSON.stringify([...storage.values.values()]).includes(first.credential.secret), false);
  assert.equal(JSON.stringify([...storage.values.values()]).includes(second.credential.secret), false);

  await revokeSoulmateCommandAgentById(identity, second.credential.agentId, { storage, fetchImpl });
  assert.deepEqual(
    (await loadSoulmateCommandAgents(identity, { storage })).map((item) => item.agentId),
    [first.credential.agentId]
  );
});

test('browser lists desktop metadata without transmitting stored secrets', async () => {
  const identity = createSoulmateCloudIdentity();
  const requests = [];
  const fetchImpl = async (url, options = {}) => {
    requests.push({ url, options });
    return Response.json({
      vaultId: identity.syncId,
      agents: [{
        agentId: 'ef53f13f-b1a5-47ff-a759-171557c32e13',
        vaultId: identity.syncId,
        displayName: 'Studio Mac',
        status: 'active',
        createdAt: '2026-08-03T10:00:00.000Z',
        lastSeenAt: null
      }]
    });
  };
  const agents = await listSoulmateCommandAgentStatuses(identity, { fetchImpl });
  assert.equal(agents.length, 1);
  assert.equal(agents[0].displayName, 'Studio Mac');
  assert.equal(requests[0].url, `/api/device-cloud/command-agents?vaultId=${identity.syncId}`);
  assert.equal(requests[0].options.body, undefined);
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
