import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createDeviceCommandAgentCredential,
  decryptDeviceCommandForAgent,
  encryptDeviceCommandForAgent,
  formatDeviceCommandPairingCode,
  parseDeviceCommandPairingCode
} from '../shared/device-command-cloud.mjs';
import { parseDeviceCommand } from '../shared/device-command.mjs';

test('desktop pairing codes preserve a 256-bit secret without exposing it to registration', async () => {
  const created = await createDeviceCommandAgentCredential('A'.repeat(22));
  assert.equal(created.registration.credentialHash.length, 43);
  assert.equal('secret' in created.registration, false);
  assert.deepEqual(parseDeviceCommandPairingCode(created.pairingCode), created.credential);
  assert.equal(formatDeviceCommandPairingCode(created.credential), created.pairingCode);
  assert.equal(parseDeviceCommandPairingCode(`${created.pairingCode}.extra`), null);
});

test('device commands are encrypted for one paired agent and reject another secret', async () => {
  const first = await createDeviceCommandAgentCredential('A'.repeat(22));
  const second = await createDeviceCommandAgentCredential('A'.repeat(22));
  const command = parseDeviceCommand('打开客厅灯');
  const envelope = await encryptDeviceCommandForAgent(command, first.credential);
  assert.equal(envelope.payload.ciphertext.includes('客厅'), false);
  assert.deepEqual(await decryptDeviceCommandForAgent(envelope, first.credential), command);
  await assert.rejects(
    decryptDeviceCommandForAgent({ ...envelope, agentId: second.credential.agentId }, second.credential),
    /decrypt/
  );
});
