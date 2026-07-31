import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createSoulmateExportBundle,
  createSoulmateProfile,
  growSoulmate
} from '../shared/soulmate-profile.mjs';
import {
  createSoulmateCloudIdentity,
  decryptSoulmateBundle,
  downloadSoulmateCloudState,
  encryptSoulmateBundle,
  formatSoulmateRecoveryCode,
  mergeSoulmateSyncBundles,
  normalizeSoulmateCloudIdentity,
  parseSoulmateRecoveryCode,
  uploadSoulmateCloudState
} from '../shared/soulmate-cloud-sync.mjs';

const now = Date.UTC(2026, 6, 30, 12, 0, 0);

function companionBundle(name = '星澜') {
  const profile = createSoulmateProfile({ name, starter: 'beautiful' }, now);
  return createSoulmateExportBundle(profile, [
    { role: 'user', content: '记住我喜欢雨天散步' },
    { role: 'assistant', content: '记住了，下雨时我会想起这句话。' }
  ], now);
}

test('recovery codes round-trip three independent random credentials', () => {
  const identity = createSoulmateCloudIdentity();
  const parsed = parseSoulmateRecoveryCode(identity.recoveryCode);
  assert.equal(formatSoulmateRecoveryCode(parsed), identity.recoveryCode);
  assert.match(identity.recoveryCode, /^NXR1-[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{43}$/);
  assert.equal(parseSoulmateRecoveryCode('NXR1-invalid'), null);
  assert.equal(normalizeSoulmateCloudIdentity({ ...identity, encryptionKey: 'short' }), null);
  assert.equal(normalizeSoulmateCloudIdentity({ ...identity, accessToken: `${identity.accessToken}A` }), null);
});

test('AES-GCM payload hides companion identity and rejects the wrong recovery code', async () => {
  const bundle = companionBundle();
  const identity = createSoulmateCloudIdentity();
  const encrypted = await encryptSoulmateBundle(bundle, identity);
  const serialized = JSON.stringify(encrypted);
  assert.doesNotMatch(serialized, /星澜|雨天散步/);
  assert.equal((await decryptSoulmateBundle(encrypted, identity)).profile.name, '星澜');

  const wrongIdentity = createSoulmateCloudIdentity();
  await assert.rejects(
    decryptSoulmateBundle(encrypted, wrongIdentity),
    /cannot decrypt/
  );
});

test('conflict merge keeps the latest identity plus memories and unique messages', () => {
  const base = createSoulmateProfile({ name: '星澜', starter: 'cute' }, now);
  const localProfile = growSoulmate(base, { kind: 'chat', text: '我喜欢夜跑' }, now + 1000);
  const remoteProfile = growSoulmate(base, { kind: 'chat', text: '今天工作有点累' }, now + 2000);
  const local = createSoulmateExportBundle(localProfile, [
    { role: 'user', content: '我喜欢夜跑' }
  ], now + 3000);
  const remote = createSoulmateExportBundle(remoteProfile, [
    { role: 'user', content: '今天工作有点累' }
  ], now + 3000);
  const merged = mergeSoulmateSyncBundles(local, remote, now + 3000);
  assert.equal(merged.profile.id, base.id);
  assert.equal(merged.profile.memories.length, 2);
  assert.equal(merged.history.length, 2);
  assert.equal(merged.profile.lastActiveAt, now + 2000);
});

test('conflict merge keeps timestamped conversation turns in chronological order', () => {
  const profile = createSoulmateProfile({ name: '星澜', starter: 'cute' }, now);
  const first = { role: 'user', content: '我把咖啡换成热巧克力了', id: 'message-001', createdAt: now + 1000 };
  const second = { role: 'assistant', content: '记住了，是热巧克力。', id: 'message-002', createdAt: now + 2000 };
  const third = { role: 'user', content: '我刚才换成什么了？', id: 'message-003', createdAt: now + 3000 };
  const local = createSoulmateExportBundle(profile, [first, third], now + 4000);
  const remote = createSoulmateExportBundle(profile, [first, second], now + 4000);
  const merged = mergeSoulmateSyncBundles(local, remote, now + 4000);

  assert.deepEqual(merged.history.map((message) => message.id), [
    'message-001',
    'message-002',
    'message-003'
  ]);
});

test('cloud client sends only ciphertext and authenticates every request', async () => {
  const identity = createSoulmateCloudIdentity();
  const bundle = companionBundle();
  const calls = [];
  const uploadFetch = async (url, options) => {
    calls.push({ url, options });
    return Response.json({ saved: true, revision: 1 });
  };
  const uploaded = await uploadSoulmateCloudState(bundle, identity, 0, uploadFetch);
  assert.equal(uploaded.revision, 1);
  assert.equal(calls[0].options.headers['X-Nexora-Sync-Token'], identity.accessToken);
  assert.doesNotMatch(calls[0].options.body, /星澜|雨天散步|encryptionKey/);

  const requestBody = JSON.parse(calls[0].options.body);
  const downloadFetch = async (_url, options) => {
    assert.equal(options.headers['X-Nexora-Sync-Token'], identity.accessToken);
    return Response.json({ revision: 1, payload: requestBody.payload });
  };
  const downloaded = await downloadSoulmateCloudState(identity, downloadFetch);
  assert.equal(downloaded.revision, 1);
  assert.equal(downloaded.bundle.profile.name, '星澜');
});
