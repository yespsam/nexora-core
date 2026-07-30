import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createSyncRecord,
  matchesSyncAccessToken,
  normalizeEncryptedSyncPayload,
  normalizeSyncAccessToken,
  normalizeSyncBaseRevision,
  normalizeSyncId,
  normalizeSyncRecord
} from '../netlify/functions/sync-data.mjs';

const syncId = 'A'.repeat(22);
const accessToken = 'B'.repeat(43);
const payload = {
  version: 1,
  algorithm: 'A256GCM',
  iv: 'C'.repeat(16),
  ciphertext: 'D'.repeat(64)
};

test('sync boundary accepts only fixed-size random identifiers and encrypted payloads', () => {
  assert.equal(normalizeSyncId(syncId), syncId);
  assert.equal(normalizeSyncId('../companion'), '');
  assert.equal(normalizeSyncAccessToken(accessToken), accessToken);
  assert.equal(normalizeSyncAccessToken('short'), '');
  assert.equal(normalizeSyncBaseRevision(0), 0);
  assert.equal(normalizeSyncBaseRevision(7), 7);
  assert.equal(normalizeSyncBaseRevision('7'), null);
  assert.equal(normalizeSyncBaseRevision(-1), null);
  assert.deepEqual(normalizeEncryptedSyncPayload(payload), payload);
  assert.equal(normalizeEncryptedSyncPayload({ ...payload, algorithm: 'plain' }), null);
});

test('stored records contain a token hash rather than the access token', () => {
  const record = createSyncRecord({
    token: accessToken,
    revision: 7,
    payload,
    now: new Date('2026-07-30T12:00:00.000Z')
  });
  assert.equal(record.revision, 7);
  assert.notEqual(record.tokenHash, accessToken);
  assert.equal(record.tokenHash.length, 64);
  assert.equal(matchesSyncAccessToken(accessToken, record.tokenHash), true);
  assert.equal(matchesSyncAccessToken('E'.repeat(43), record.tokenHash), false);
  assert.deepEqual(normalizeSyncRecord(record), record);
});
