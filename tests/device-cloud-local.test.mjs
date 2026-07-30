import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  createDeviceCloudKeys,
  createRecoveryEnvelope,
  createVaultKey,
  fromBase64Url,
  toBase64Url,
  unwrapDeviceEnvelope,
  unwrapRecoveryEnvelope,
  wrapVaultKeyForDevice
} from '../shared/device-cloud-crypto.mjs';
import {
  normalizeDevice,
  normalizeRecoveryEnvelope
} from '../cloud/device-cloud-validation.mjs';

const crypto = globalThis.crypto;

test('base64url conversion is canonical and browser-compatible', () => {
  const bytes = Uint8Array.from({ length: 32 }, (_, index) => index);
  const encoded = toBase64Url(bytes);
  assert.equal(encoded.length, 43);
  assert.deepEqual(fromBase64Url(encoded, 32, 32), bytes);
  assert.throws(() => fromBase64Url(`${encoded}=`, 32, 32), /invalid base64url/);
  assert.throws(() => fromBase64Url('A', 0, 32), /invalid base64url/);
});

test('device and recovery envelopes wrap a real 256-bit vault key', async () => {
  const vaultKey = await createVaultKey();
  const keys = await createDeviceCloudKeys();
  const deviceEnvelope = await wrapVaultKeyForDevice(vaultKey, keys.exchangePublicJwk);
  const recovery = await createRecoveryEnvelope(vaultKey);
  const deviceRecovered = await unwrapDeviceEnvelope(deviceEnvelope, keys.exchange.privateKey);
  const recovered = await unwrapRecoveryEnvelope(recovery.wrappedVaultKey, recovery.recoverySecret);
  const [originalBytes, deviceRecoveredBytes, recoveredBytes] = await Promise.all([
    crypto.subtle.exportKey('raw', vaultKey),
    crypto.subtle.exportKey('raw', deviceRecovered),
    crypto.subtle.exportKey('raw', recovered)
  ]);

  assert.ok(fromBase64Url(deviceEnvelope, 40, 2048).byteLength > 40);
  assert.equal(Buffer.from(originalBytes).equals(Buffer.from(deviceRecoveredBytes)), true);
  assert.equal(Buffer.from(originalBytes).equals(Buffer.from(recoveredBytes)), true);
  assert.equal(fromBase64Url(recovery.recoveryKeyId, 32, 32).byteLength, 32);
});

test('local registration accepts public P-256 keys and rejects private key material', async () => {
  const keys = await createDeviceCloudKeys();
  const vaultKey = await createVaultKey();
  const wrappedVaultKey = await wrapVaultKeyForDevice(vaultKey, keys.exchangePublicJwk);
  const value = {
    id: crypto.randomUUID(),
    type: 'phone',
    displayName: 'Test Phone',
    signingKeyId: `device:${crypto.randomUUID()}`,
    signingPublicJwk: keys.signingPublicJwk,
    exchangePublicJwk: keys.exchangePublicJwk,
    wrappedVaultKey
  };
  assert.equal(normalizeDevice(value).type, 'phone');
  assert.throws(() => normalizeDevice({
    ...value,
    signingPublicJwk: { ...value.signingPublicJwk, d: 'private' }
  }), /invalid signing public key/);
  assert.throws(() => normalizeRecoveryEnvelope({
    recoveryKeyId: 'short',
    wrappedVaultKey
  }), /invalid recovery key id/);
});

test('local roles keep event deletion out of the API role', async () => {
  const roles = await readFile(new URL('../cloud/local/runtime-roles.sql', import.meta.url), 'utf8');
  const maintenance = await readFile(
    new URL('../cloud/migrations/002_event_maintenance_policy.sql', import.meta.url),
    'utf8'
  );
  assert.match(roles, /SELECT, INSERT ON nexora_cloud\.companion_events TO nexora_cloud_api/);
  assert.doesNotMatch(roles, /DELETE ON nexora_cloud\.companion_events TO nexora_cloud_api/);
  assert.match(roles, /REVOKE UPDATE, DELETE ON nexora_cloud\.deletion_requests FROM nexora_cloud_api/);
  assert.match(maintenance, /companion_events_maintenance_delete_policy/);
});
