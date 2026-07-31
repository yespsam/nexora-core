import assert from 'node:assert/strict';
import test from 'node:test';

import { createSoulmateProfile } from '../shared/soulmate-profile.mjs';
import {
  SOULMATE_SYNC_STORAGE_KEY,
  createSoulmateSyncEnvelope,
  loadSoulmateSyncSnapshot,
  normalizeSoulmateSyncEnvelope,
  openSoulmateSync
} from '../shared/soulmate-sync.mjs';

const now = Date.UTC(2026, 6, 30, 8, 0, 0);

test('continuity envelopes keep one normalized identity and recent conversation', () => {
  const profile = createSoulmateProfile({ name: '星澜', starter: 'beautiful' }, now);
  const envelope = createSoulmateSyncEnvelope(profile, [
    { role: 'user', content: '今天也一起工作吧' },
    { role: 'assistant', content: '好，我陪着你。' }
  ], {
    sourceId: 'desktop@unsafe',
    revision: 42,
    now
  });

  assert.equal(envelope.sourceId, 'desktopunsafe');
  assert.equal(envelope.profileId, profile.id);
  assert.equal(envelope.bundle.profile.starter, 'beautiful');
  assert.equal(envelope.bundle.history.length, 2);
  assert.equal(normalizeSoulmateSyncEnvelope(envelope, now)?.revision, 42);
});

test('continuity receiver accepts newer remote state and rejects stale or local echoes', () => {
  const profile = createSoulmateProfile({ name: '星澜' }, now);
  const received = [];
  const sync = openSoulmateSync({
    sourceId: 'phone',
    onState: (bundle) => received.push(bundle),
    storage: null,
    eventTarget: null,
    channelFactory: null
  });
  const remote = createSoulmateSyncEnvelope(profile, [], {
    sourceId: 'desktop',
    revision: 100,
    now
  });
  const stale = createSoulmateSyncEnvelope(profile, [], {
    sourceId: 'pendant',
    revision: 99,
    now
  });
  const localEcho = createSoulmateSyncEnvelope(profile, [], {
    sourceId: 'phone',
    revision: 101,
    now
  });

  assert.equal(sync.receive(remote), true);
  assert.equal(sync.receive(stale), false);
  assert.equal(sync.receive(localEcho), false);
  assert.equal(received.length, 1);
  assert.equal(received[0].profile.name, '星澜');
  sync.close();
});

test('continuity publisher writes the same envelope to storage and channel', () => {
  const profile = createSoulmateProfile({ name: '星澜', starter: 'cool' }, now);
  const writes = [];
  const posts = [];
  const channel = {
    addEventListener() {},
    removeEventListener() {},
    postMessage(value) { posts.push(value); },
    close() {}
  };
  const sync = openSoulmateSync({
    sourceId: 'desktop',
    storage: { setItem: (key, value) => writes.push([key, JSON.parse(value)]) },
    eventTarget: null,
    channelFactory: () => channel
  });

  const envelope = sync.publish(profile, [{ role: 'user', content: '记住我喜欢夜跑' }]);
  assert.equal(envelope.profileId, profile.id);
  assert.equal(writes.length, 1);
  assert.equal(posts.length, 1);
  assert.deepEqual(writes[0][1], posts[0]);
  assert.equal(posts[0].bundle.history[0].content, '记住我喜欢夜跑');
  sync.close();
});

test('continuity restores a stored snapshot during startup', () => {
  const profile = createSoulmateProfile({ name: '星澜', starter: 'beautiful' }, now);
  const stored = createSoulmateSyncEnvelope(profile, [
    { role: 'assistant', content: '我还记得你。' }
  ], {
    sourceId: 'previous-tab',
    revision: 180,
    now
  });
  const received = [];
  const storage = {
    getItem(key) {
      return key === SOULMATE_SYNC_STORAGE_KEY ? JSON.stringify(stored) : null;
    },
    setItem() {}
  };
  const sync = openSoulmateSync({
    sourceId: 'new-tab',
    storage,
    eventTarget: null,
    channelFactory: null,
    onState: (bundle) => received.push(bundle)
  });

  assert.equal(received.length, 1);
  assert.equal(received[0].profile.name, '星澜');
  assert.equal(received[0].history[0].content, '我还记得你。');
  assert.equal(loadSoulmateSyncSnapshot(storage, now)?.revision, 180);
  sync.close();
});

test('explicit reset can suppress stored continuity hydration', () => {
  const profile = createSoulmateProfile({ name: '星澜' }, now);
  const stored = createSoulmateSyncEnvelope(profile, [], {
    sourceId: 'previous-tab',
    revision: 181,
    now
  });
  const received = [];
  const sync = openSoulmateSync({
    sourceId: 'reset-tab',
    storage: { getItem: () => JSON.stringify(stored), setItem() {} },
    eventTarget: null,
    channelFactory: null,
    hydrateStoredState: false,
    onState: (bundle) => received.push(bundle)
  });

  assert.equal(received.length, 0);
  sync.close();
});
