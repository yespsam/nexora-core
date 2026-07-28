import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PENDANT_SIMULATOR_STORAGE_KEY,
  createPendantSimulatorEnvelope,
  decodePendantSimulatorPayload,
  normalizePendantSimulatorSnapshot,
  observePendantSimulator
} from '../shared/pendant-simulator.mjs';

const validSnapshot = {
  v: 1,
  profileId: 'soulmate-test',
  name: '星澜',
  starter: 'cute',
  stage: 'young',
  bond: 88,
  state: 'speaking'
};

test('pendant simulator decodes the same byte payload written over BLE', () => {
  const payload = new TextEncoder().encode(JSON.stringify(validSnapshot));
  assert.deepEqual(decodePendantSimulatorPayload(payload), validSnapshot);
});

test('pendant simulator bounds hardware-only fields and rejects missing identity', () => {
  assert.equal(normalizePendantSimulatorSnapshot({ state: 'idle' }), null);
  assert.deepEqual(normalizePendantSimulatorSnapshot({
    ...validSnapshot,
    battery: -40,
    bond: 20000,
    state: 'unknown',
    notice: '  该休息一下啦  '
  }), {
    ...validSnapshot,
    bond: 9999,
    state: 'idle',
    battery: 0,
    notice: '该休息一下啦'
  });
});

test('pendant simulator envelope is versioned and deterministic', () => {
  const envelope = createPendantSimulatorEnvelope(JSON.stringify(validSnapshot), 123456);
  assert.deepEqual(envelope, {
    version: 1,
    type: 'snapshot',
    sentAt: 123456,
    snapshot: validSnapshot
  });
});

test('explicit preview can ignore the previously stored simulator snapshot', async () => {
  const stored = createPendantSimulatorEnvelope(JSON.stringify(validSnapshot), 123456);
  const storage = { getItem: () => JSON.stringify(stored) };
  const delivered = [];
  const stop = observePendantSimulator((snapshot) => delivered.push(snapshot), storage, {
    replayStored: false
  });
  await Promise.resolve();
  stop();
  assert.deepEqual(delivered, []);
});

test('storage events synchronize the pendant when BroadcastChannel is unavailable', () => {
  const listeners = new Map();
  const eventTarget = {
    addEventListener(type, listener) { listeners.set(type, listener); },
    removeEventListener(type, listener) {
      if (listeners.get(type) === listener) listeners.delete(type);
    }
  };
  const delivered = [];
  const stop = observePendantSimulator(
    (snapshot) => delivered.push(snapshot),
    { getItem: () => null },
    { replayStored: false, eventTarget }
  );
  const envelope = createPendantSimulatorEnvelope(JSON.stringify(validSnapshot), 654321);

  listeners.get('storage')({
    key: PENDANT_SIMULATOR_STORAGE_KEY,
    newValue: JSON.stringify(envelope)
  });

  assert.deepEqual(delivered, [validSnapshot]);
  stop();
  assert.equal(listeners.has('storage'), false);
});

test('duplicate storage and broadcast deliveries are applied once', () => {
  const listeners = new Map();
  const eventTarget = {
    addEventListener(type, listener) { listeners.set(type, listener); },
    removeEventListener() {}
  };
  const delivered = [];
  const stop = observePendantSimulator(
    (snapshot) => delivered.push(snapshot),
    { getItem: () => null },
    { replayStored: false, eventTarget }
  );
  const envelope = createPendantSimulatorEnvelope(JSON.stringify(validSnapshot), 777777);
  const serialized = JSON.stringify(envelope);

  listeners.get('storage')({ key: PENDANT_SIMULATOR_STORAGE_KEY, newValue: serialized });
  listeners.get('storage')({ key: PENDANT_SIMULATOR_STORAGE_KEY, newValue: serialized });

  assert.equal(delivered.length, 1);
  stop();
});
