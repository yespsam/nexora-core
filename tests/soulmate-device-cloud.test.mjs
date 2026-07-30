import assert from 'node:assert/strict';
import test from 'node:test';

import {
  canonicalDeviceCloudEvent,
  normalizeDeviceCloudEvent
} from '../shared/device-cloud-protocol.mjs';
import { fromBase64Url, toBase64Url } from '../shared/device-cloud-crypto.mjs';
import {
  clearSoulmateDeviceCloudState,
  getSoulmateDeviceCloudDiagnostic,
  mirrorSoulmateCloudState,
  requestSoulmateDeviceCloudDeletion
} from '../shared/soulmate-device-cloud.mjs';
import { createSoulmateCloudIdentity } from '../shared/soulmate-cloud-sync.mjs';
import {
  createSoulmateExportBundle,
  createSoulmateProfile,
  growSoulmate
} from '../shared/soulmate-profile.mjs';

function memoryStorage() {
  const values = new Map();
  return {
    values,
    async get(key) { return values.get(key); },
    async put(key, value) { values.set(key, structuredClone(value)); },
    async delete(key) { values.delete(key); }
  };
}

function companionBundle(name = '星澜', now = Date.UTC(2026, 6, 31, 8, 0, 0)) {
  const profile = createSoulmateProfile({ name, starter: 'beautiful' }, now);
  return createSoulmateExportBundle(profile, [
    { role: 'user', content: '记住我喜欢雨天散步' },
    { role: 'assistant', content: '记住了。' }
  ], now);
}

function deviceCloudHarness() {
  const events = [];
  const calls = [];
  let enabled = true;
  let dualWrite = true;
  let failAfterCommit = false;
  let failBootstrap = false;
  let failAfterBootstrapCommit = false;
  let bootstrapCommitted = false;
  let deletionRequest = '';
  let bootstrapBody = null;

  async function fetchImpl(input, options = {}) {
    const url = new URL(input, 'https://private.test');
    const method = options.method || 'GET';
    calls.push({ path: url.pathname, method });
    if (url.pathname === '/api/device-cloud/status') {
      return enabled
        ? Response.json({ enabled: true, authenticated: true, dualWrite })
        : Response.json({ error: 'not_found' }, { status: 404 });
    }
    if (url.pathname === '/api/device-cloud/bootstrap') {
      if (failBootstrap) return Response.json({ error: 'unavailable' }, { status: 503 });
      if (bootstrapCommitted) return Response.json({ error: 'conflict' }, { status: 409 });
      bootstrapBody = JSON.parse(options.body);
      bootstrapCommitted = true;
      if (failAfterBootstrapCommit) {
        failAfterBootstrapCommit = false;
        throw new Error('connection closed after bootstrap commit');
      }
      return Response.json({ created: true }, { status: 201 });
    }
    if (url.pathname === '/api/device-cloud/devices') {
      const body = JSON.parse(options.body);
      if (body.device?.id === bootstrapBody?.device?.id) {
        return Response.json({ error: 'conflict' }, { status: 409 });
      }
      return Response.json({ created: true }, { status: 201 });
    }
    if (url.pathname === '/api/device-cloud/events' && method === 'POST') {
      const event = JSON.parse(options.body);
      assert.ok(normalizeDeviceCloudEvent(event));
      let saved = events.find((entry) => entry.event.eventId === event.eventId);
      if (!saved) {
        const contentHash = toBase64Url(await crypto.subtle.digest(
          'SHA-256',
          new TextEncoder().encode(canonicalDeviceCloudEvent(event))
        ));
        saved = { cursor: events.length + 1, contentHash, event };
        events.push(saved);
        if (failAfterCommit) {
          failAfterCommit = false;
          throw new Error('connection closed after commit');
        }
      }
      return Response.json({
        cursor: saved.cursor,
        duplicate: events.filter((entry) => entry.event.eventId === event.eventId).length > 1,
        contentHash: saved.contentHash
      }, { status: 201 });
    }
    if (url.pathname === '/api/device-cloud/events' && method === 'GET') {
      const after = Number(url.searchParams.get('after') || 0);
      return Response.json({
        events: events
          .filter((entry) => entry.cursor > after)
          .map((entry) => ({ ...entry.event, cursor: entry.cursor, contentHash: entry.contentHash })),
        nextCursor: events.at(-1)?.cursor || after,
        hasMore: false
      });
    }
    if (url.pathname === '/api/device-cloud/deletions') {
      deletionRequest = 'ef53f13f-b1a5-47ff-a759-171557c32e13';
      return Response.json({ requestId: deletionRequest, status: 'scheduled' }, { status: 202 });
    }
    return Response.json({ error: 'not_found' }, { status: 404 });
  }

  return {
    calls,
    events,
    fetchImpl,
    get bootstrapBody() { return bootstrapBody; },
    get deletionRequest() { return deletionRequest; },
    set enabled(value) { enabled = value; },
    set dualWrite(value) { dualWrite = value; },
    set failAfterCommit(value) { failAfterCommit = value; },
    set failBootstrap(value) { failBootstrap = value; },
    set failAfterBootstrapCommit(value) { failAfterBootstrapCommit = value; }
  };
}

test('dual write is inert while the server flag is disabled', async () => {
  const identity = createSoulmateCloudIdentity();
  const storage = memoryStorage();
  const result = await mirrorSoulmateCloudState(companionBundle(), identity, 1, {
    storage,
    fetchImpl: async () => Response.json({ enabled: true, dualWrite: false })
  });
  assert.deepEqual(result, {
    enabled: false,
    mirrored: false,
    verified: false,
    reason: 'disabled'
  });
  assert.equal(storage.values.size, 0);
});

test('dual write registers one device, appends encrypted events, and verifies readback', async () => {
  const identity = createSoulmateCloudIdentity();
  const storage = memoryStorage();
  const cloud = deviceCloudHarness();
  const firstBundle = companionBundle();
  const first = await mirrorSoulmateCloudState(firstBundle, identity, 1, {
    storage,
    fetchImpl: cloud.fetchImpl
  });
  assert.equal(first.enabled, true);
  assert.equal(first.mirrored, true);
  assert.equal(first.verified, true);
  assert.equal(cloud.events.length, 1);
  assert.deepEqual(await getSoulmateDeviceCloudDiagnostic(identity, { storage }), {
    registered: true,
    mirroredRevision: 1,
    verifiedRevision: 1,
    cursor: 1,
    pending: false
  });
  assert.doesNotMatch(JSON.stringify(cloud.events[0].event), /星澜|雨天散步/);
  assert.equal(cloud.calls.filter((call) => call.path.endsWith('/bootstrap')).length, 1);

  const signingKey = await crypto.subtle.importKey(
    'jwk',
    cloud.bootstrapBody.device.signingPublicJwk,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['verify']
  );
  assert.equal(await crypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' },
    signingKey,
    fromBase64Url(cloud.events[0].event.auth.signature, 64, 64),
    new TextEncoder().encode(canonicalDeviceCloudEvent(cloud.events[0].event))
  ), true);

  assert.equal(cloud.events[0].event.deviceSequence, 1);
  const storedEnvelope = JSON.stringify([...storage.values.values()]);
  assert.doesNotMatch(storedEnvelope, /星澜|雨天散步|migration\.snapshot/);

  const current = await mirrorSoulmateCloudState(firstBundle, identity, 1, {
    storage,
    fetchImpl: cloud.fetchImpl
  });
  assert.equal(current.mirrored, false);
  assert.equal(current.verified, true);
  assert.equal(current.reason, 'current');
  assert.equal(cloud.events.length, 1);

  const nextProfile = growSoulmate(firstBundle.profile, { kind: 'chat', text: '今天想去夜跑' });
  const nextBundle = createSoulmateExportBundle(nextProfile, firstBundle.history);
  const second = await mirrorSoulmateCloudState(nextBundle, identity, 2, {
    storage,
    fetchImpl: cloud.fetchImpl
  });
  assert.equal(second.mirrored, true);
  assert.equal(second.verified, true);
  assert.equal(cloud.events.length, 2);
  assert.equal(cloud.events[1].event.deviceSequence, 2);
  assert.equal(cloud.events[1].event.previousEventHash, cloud.events[0].contentHash);
});

test('a committed event survives a lost response and retries idempotently', async () => {
  const identity = createSoulmateCloudIdentity();
  const storage = memoryStorage();
  const cloud = deviceCloudHarness();
  cloud.failAfterCommit = true;
  const first = await mirrorSoulmateCloudState(companionBundle(), identity, 1, {
    storage,
    fetchImpl: cloud.fetchImpl
  });
  assert.equal(first.reason, 'unavailable');
  assert.equal(cloud.events.length, 1);

  const retried = await mirrorSoulmateCloudState(companionBundle(), identity, 1, {
    storage,
    fetchImpl: cloud.fetchImpl
  });
  assert.equal(retried.mirrored, true);
  assert.equal(retried.verified, true);
  assert.equal(cloud.events.length, 1);
});

test('a committed bootstrap survives a lost response without replacing device keys', async () => {
  const identity = createSoulmateCloudIdentity();
  const storage = memoryStorage();
  const cloud = deviceCloudHarness();
  cloud.failAfterBootstrapCommit = true;
  const first = await mirrorSoulmateCloudState(companionBundle(), identity, 1, {
    storage,
    fetchImpl: cloud.fetchImpl
  });
  assert.equal(first.reason, 'unavailable');
  assert.equal(storage.values.size, 1);
  const committedDeviceId = cloud.bootstrapBody.device.id;

  const retried = await mirrorSoulmateCloudState(companionBundle(), identity, 1, {
    storage,
    fetchImpl: cloud.fetchImpl
  });
  assert.equal(retried.mirrored, true);
  assert.equal(retried.verified, true);
  assert.equal(cloud.events.length, 1);
  assert.equal(cloud.events[0].event.deviceId, committedDeviceId);
});

test('mirror failures return a report instead of failing the legacy sync path', async () => {
  const identity = createSoulmateCloudIdentity();
  const cloud = deviceCloudHarness();
  cloud.failBootstrap = true;
  const result = await mirrorSoulmateCloudState(companionBundle(), identity, 1, {
    storage: memoryStorage(),
    fetchImpl: cloud.fetchImpl
  });
  assert.deepEqual(result, {
    enabled: true,
    mirrored: false,
    verified: false,
    reason: 'unavailable'
  });

  const noCrypto = await mirrorSoulmateCloudState(companionBundle(), identity, 1, {
    crypto: {},
    storage: memoryStorage(),
    fetchImpl: cloud.fetchImpl
  });
  assert.equal(noCrypto.reason, 'unavailable');
});

test('cloud deletion remains required after dual write is switched off', async () => {
  const identity = createSoulmateCloudIdentity();
  const storage = memoryStorage();
  const cloud = deviceCloudHarness();
  await mirrorSoulmateCloudState(companionBundle(), identity, 1, {
    storage,
    fetchImpl: cloud.fetchImpl
  });
  cloud.dualWrite = false;
  const deletion = await requestSoulmateDeviceCloudDeletion(identity, {
    storage,
    fetchImpl: cloud.fetchImpl
  });
  assert.equal(deletion.enabled, true);
  assert.equal(deletion.scheduled, true);
  assert.equal(deletion.requestId, cloud.deletionRequest);
  await clearSoulmateDeviceCloudState(identity, { storage });
  assert.equal(storage.values.size, 0);
});
