import assert from 'node:assert/strict';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  createDeviceCommandAgentCredential,
  encryptDeviceCommandForAgent
} from '../shared/device-command-cloud.mjs';
import { parseDeviceCommand } from '../shared/device-command.mjs';
import {
  createNexoraBridgeCloudConfig,
  createNexoraCloudCommandPoller,
  loadNexoraBridgeCloudConfig,
  normalizeNexoraCloudSite,
  saveNexoraBridgeCloudConfig
} from '../tools/nexora-bridge-cloud.mjs';

test('bridge cloud configuration accepts only the product site or local harness', async () => {
  const paired = await createDeviceCommandAgentCredential('A'.repeat(22));
  assert.equal(normalizeNexoraCloudSite('https://attacker.example'), '');
  assert.equal(normalizeNexoraCloudSite('http://127.0.0.1:9999'), 'http://127.0.0.1:9999');
  assert.throws(() => createNexoraBridgeCloudConfig(paired.pairingCode, {
    siteUrl: 'https://attacker.example'
  }), /invalid/);
});

test('bridge pairing credentials are stored in a user-only file', async (context) => {
  const directory = await mkdtemp(join(tmpdir(), 'nexora-bridge-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'bridge.json');
  const paired = await createDeviceCommandAgentCredential('A'.repeat(22));
  const config = createNexoraBridgeCloudConfig(paired.pairingCode, { siteUrl: 'http://localhost:9999' });
  await saveNexoraBridgeCloudConfig(config, { path });
  assert.equal((await stat(path)).mode & 0o777, 0o600);
  assert.deepEqual(await loadNexoraBridgeCloudConfig({ path }), config);
});

test('bridge decrypts one cloud command, executes it, and acknowledges with bearer auth', async () => {
  const paired = await createDeviceCommandAgentCredential('A'.repeat(22));
  const encrypted = await encryptDeviceCommandForAgent(
    parseDeviceCommand('把电脑音量调到35'),
    paired.credential
  );
  const commandId = crypto.randomUUID();
  const requests = [];
  let claimed = false;
  const fetchImpl = async (url, options = {}) => {
    requests.push({ url, options });
    if (url.includes('/commands?') && !claimed) {
      claimed = true;
      return Response.json({
        command: {
          ...encrypted,
          commandId,
          createdAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 60000).toISOString(),
          deliveredAt: new Date().toISOString()
        }
      });
    }
    return Response.json({ commandId, status: 'acknowledged' });
  };
  const executed = [];
  const poller = createNexoraCloudCommandPoller({
    config: createNexoraBridgeCloudConfig(paired.pairingCode, { siteUrl: 'http://127.0.0.1:9999' }),
    fetchImpl,
    execute: async (command) => {
      executed.push(command);
      return { ok: true, status: 'simulated' };
    }
  });
  const result = await poller.pollOnce();
  assert.equal(result.status, 'acknowledged');
  assert.equal(executed[0].action, 'volume.set');
  assert.equal(requests.length, 2);
  assert.equal(requests[0].options.headers.Authorization, `Bearer ${paired.credential.secret}`);
  assert.deepEqual(JSON.parse(requests[1].options.body), { outcome: 'acknowledged' });
});

test('bridge reports idle without attempting execution when the queue is empty', async () => {
  const paired = await createDeviceCommandAgentCredential('A'.repeat(22));
  let executions = 0;
  const poller = createNexoraCloudCommandPoller({
    config: createNexoraBridgeCloudConfig(paired.pairingCode, { siteUrl: 'http://localhost:9999' }),
    fetchImpl: async () => Response.json({ command: null }),
    execute: async () => { executions += 1; }
  });
  assert.deepEqual(await poller.pollOnce(), { status: 'idle' });
  assert.equal(executions, 0);
});
