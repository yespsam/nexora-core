import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createSoulmateExportBundle,
  createSoulmateProfile,
  growSoulmate,
  normalizeSoulmateProfile,
  stageForBond
} from '../shared/soulmate-profile.mjs';
import {
  mergeSoulmateSyncBundles
} from '../shared/soulmate-cloud-sync.mjs';
import {
  SOULMATE_CLOUD_RETRY_DELAYS_MS,
  canResumeSoulmateCloudSync,
  soulmateCloudRetryDelay
} from '../shared/soulmate-resilience.mjs';

const day = 86400000;
const start = Date.UTC(2026, 0, 1);

test('one year and sustained daily interaction preserve one bounded companion', () => {
  let profile = createSoulmateProfile({
    name: '星澜',
    starter: 'beautiful',
    temperament: 'curious'
  }, start);

  for (let index = 0; index < 1300; index += 1) {
    const text = index < 180
      ? `今天完成了第 ${index} 次散步计划`
      : '抱抱，今天也一起待一会儿';
    profile = growSoulmate(profile, { kind: 'chat', text }, start + index * 1000);
  }

  const oneYearLater = normalizeSoulmateProfile(profile, start + 365 * day);
  assert.equal(oneYearLater.id, profile.id);
  assert.equal(oneYearLater.daysTogether, 366);
  assert.equal(oneYearLater.interactions, 1300);
  assert.equal(oneYearLater.bond, 9999);
  assert.equal(oneYearLater.memories.length, 48);
  assert.equal(stageForBond(oneYearLater.bond, oneYearLater.starter).id, 'resonance');
  assert.ok(Object.values(oneYearLater.traits).every((value) => value >= 0 && value <= 100));
});

test('concurrent devices retain independent personality growth', () => {
  const base = createSoulmateProfile({ name: '星澜', starter: 'cute' }, start);
  const localProfile = growSoulmate(
    base,
    { kind: 'chat', text: '为什么我喜欢夜跑？' },
    start + 1000
  );
  const remoteProfile = growSoulmate(
    base,
    { kind: 'chat', text: '今天工作很累' },
    start + 2000
  );
  const merged = mergeSoulmateSyncBundles(
    createSoulmateExportBundle(localProfile, [], start + 3000),
    createSoulmateExportBundle(remoteProfile, [], start + 3000),
    start + 3000
  );

  assert.equal(merged.profile.traits.curiosity, localProfile.traits.curiosity);
  assert.equal(merged.profile.traits.warmth, localProfile.traits.warmth);
  assert.equal(merged.profile.traits.steadiness, remoteProfile.traits.steadiness);
});

test('repeated cloud conflict merges stay idempotent and collapse duplicate memories', () => {
  const base = createSoulmateProfile({ name: '星澜' }, start);
  const localProfile = growSoulmate(
    base,
    { kind: 'chat', text: '我喜欢雨天散步' },
    start + 1000
  );
  const remoteProfile = growSoulmate(
    base,
    { kind: 'chat', text: '我喜欢雨天散步' },
    start + 2000
  );
  const remote = createSoulmateExportBundle(remoteProfile, [
    { role: 'user', content: '我喜欢雨天散步' }
  ], start + 3000);
  let merged = createSoulmateExportBundle(localProfile, [
    { role: 'user', content: '我喜欢雨天散步' }
  ], start + 3000);

  for (let index = 0; index < 100; index += 1) {
    merged = mergeSoulmateSyncBundles(merged, remote, start + 4000 + index);
  }

  assert.equal(merged.profile.memories.length, 1);
  assert.equal(merged.profile.bond, 8);
  assert.equal(merged.profile.interactions, 1);
  assert.equal(merged.history.length, 1);
});

test('cloud retry backs off and resumes only when a dirty companion is online', () => {
  assert.deepEqual(
    [0, 1, 2, 3, 4, 20].map(soulmateCloudRetryDelay),
    [...SOULMATE_CLOUD_RETRY_DELAYS_MS, 60000]
  );
  const active = {
    ready: true,
    identity: { syncId: 'device' },
    profile: { id: 'companion' },
    dirty: true,
    online: true
  };
  assert.equal(canResumeSoulmateCloudSync(active), true);
  assert.equal(canResumeSoulmateCloudSync({ ...active, online: false }), false);
  assert.equal(canResumeSoulmateCloudSync({ ...active, dirty: false }), false);
  assert.equal(canResumeSoulmateCloudSync({ ...active, busy: true }), false);
});
