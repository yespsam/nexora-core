import assert from 'node:assert/strict';
import test from 'node:test';

import {
  canonicalDeviceCloudEvent,
  deviceCloudEventStorageKey,
  normalizeDeviceCloudEvent
} from '../shared/device-cloud-protocol.mjs';

const event = {
  version: 1,
  eventId: '019f9074-0e22-7e4b-8f33-f93e84c655d1',
  vaultId: 'A'.repeat(22),
  deviceId: 'ef53f13f-b1a5-47ff-a759-171557c32e13',
  deviceSequence: 42,
  occurredAt: '2026-07-30T12:00:00.000Z',
  keyVersion: 3,
  previousEventHash: 'B'.repeat(43),
  payload: {
    algorithm: 'A256GCM',
    iv: 'C'.repeat(16),
    ciphertext: 'D'.repeat(64)
  },
  auth: {
    algorithm: 'ES256',
    keyId: 'nc01:factory:2026-01',
    signature: 'E'.repeat(86)
  }
};

test('device cloud events expose sync metadata but only encrypted companion content', () => {
  const normalized = normalizeDeviceCloudEvent({
    ...event,
    name: '不应进入外层协议',
    transcript: '不应进入外层协议'
  });
  assert.equal(normalized.deviceSequence, 42);
  assert.equal(normalized.payload.algorithm, 'A256GCM');
  assert.equal('name' in normalized, false);
  assert.equal('transcript' in normalized, false);
  assert.doesNotMatch(JSON.stringify(normalized), /不应进入外层协议/);
});

test('canonical event bytes do not include the signature and remain deterministic', () => {
  const first = canonicalDeviceCloudEvent(event);
  const second = canonicalDeviceCloudEvent({
    auth: event.auth,
    payload: event.payload,
    previousEventHash: event.previousEventHash,
    keyVersion: event.keyVersion,
    occurredAt: event.occurredAt,
    deviceSequence: event.deviceSequence,
    deviceId: event.deviceId,
    vaultId: event.vaultId,
    eventId: event.eventId,
    version: event.version
  });
  assert.equal(first, second);
  assert.doesNotMatch(first, new RegExp(event.auth.signature));
});

test('device event boundaries reject malformed ids, counters, ciphertext, and signatures', () => {
  assert.equal(normalizeDeviceCloudEvent({ ...event, deviceId: '../device' }), null);
  assert.equal(normalizeDeviceCloudEvent({ ...event, deviceSequence: '42' }), null);
  assert.equal(normalizeDeviceCloudEvent({ ...event, deviceSequence: 2, previousEventHash: '' }), null);
  assert.equal(normalizeDeviceCloudEvent({ ...event, deviceSequence: 1, previousEventHash: 'B'.repeat(43) }), null);
  assert.equal(normalizeDeviceCloudEvent({ ...event, keyVersion: 0 }), null);
  assert.equal(normalizeDeviceCloudEvent({ ...event, payload: { ...event.payload, algorithm: 'plain' } }), null);
  assert.equal(normalizeDeviceCloudEvent({ ...event, payload: { ...event.payload, ciphertext: 'D'.repeat(25) } }), null);
  assert.equal(normalizeDeviceCloudEvent({ ...event, auth: { ...event.auth, signature: 'short' } }), null);
});

test('ciphertext limits align with the decoded PostgreSQL byte limits', () => {
  assert.ok(normalizeDeviceCloudEvent({
    ...event,
    payload: { ...event.payload, ciphertext: 'D'.repeat(23) }
  }));
  assert.ok(normalizeDeviceCloudEvent({
    ...event,
    payload: { ...event.payload, ciphertext: 'D'.repeat(349526) }
  }));
  assert.equal(normalizeDeviceCloudEvent({
    ...event,
    payload: { ...event.payload, ciphertext: 'D'.repeat(349527) }
  }), null);
});

test('storage keys are ordered per device sequence and scoped to the public vault id', () => {
  assert.equal(
    deviceCloudEventStorageKey(event),
    `${event.vaultId}/${event.deviceId}/0000000000000042/${event.eventId}`
  );
});
