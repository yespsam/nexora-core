import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createSoulmateExportBundle,
  createSoulmateProfile,
  growSoulmate,
  normalizeSoulmateExportBundle,
  normalizeSoulmateHistory,
  normalizeSoulmateProfile,
  soulmateStarters,
  soulmatePromptProfile,
  stageForBond,
  stageProgress,
  stagesForStarter
} from '../shared/soulmate-profile.mjs';
import {
  PENDANT_BLE_MAX_BYTES,
  PENDANT_BLE_SERVICE_UUID,
  createPendantBleSnapshot,
  encodePendantBleSnapshot
} from '../shared/pendant-ble.mjs';
import {
  PENDANT_DISPLAY_SIZE,
  createPendantDisplaySnapshot,
  nextPendantInteractionState
} from '../shared/pendant-display.mjs';

test('creates a named Soulmate with a stable identity seed', () => {
  const profile = createSoulmateProfile({
    name: '星澜',
    birthday: '2026-07-28',
    gender: 'neutral',
    voice: 'soft',
    temperament: 'curious',
    starter: 'cool'
  }, Date.UTC(2026, 6, 28));
  assert.equal(profile.name, '星澜');
  assert.equal(profile.birthday, '2026-07-28');
  assert.equal(profile.traits.curiosity, 70);
  assert.equal(profile.starter, 'cool');
  assert.match(stageForBond(profile.bond, profile.starter).asset, /cool-seed/);
});

test('offers three original starters with independent evolution assets', () => {
  assert.deepEqual(soulmateStarters.map((starter) => starter.id), ['cute', 'cool', 'beautiful']);
  soulmateStarters.forEach((starter) => {
    const stages = stagesForStarter(starter.id);
    assert.equal(stages.length, 3);
    assert.ok(stages.every((stage) => stage.asset.includes(`/starters/${starter.id}-`)));
  });
});

test('chat grows bond, traits, and bounded memories', () => {
  let profile = createSoulmateProfile({ name: '星澜' }, 1000);
  for (let index = 0; index < 60; index += 1) {
    profile = growSoulmate(profile, { kind: 'chat', text: `我想知道今天的第 ${index} 件事？` }, 2000 + index);
  }
  assert.equal(profile.memories.length, 48);
  assert.ok(profile.memories.every((memory) => memory.version === 1 && memory.summary));
  assert.ok(profile.bond >= 240);
  assert.equal(stageForBond(profile.bond).id, 'resonance');
  assert.ok(profile.traits.curiosity > 42);
});

test('normalization rejects incompatible records and recalculates days together', () => {
  assert.equal(normalizeSoulmateProfile({ version: 99 }), null);
  const createdAt = Date.UTC(2026, 6, 20);
  const now = Date.UTC(2026, 6, 28);
  const profile = createSoulmateProfile({ name: '星澜' }, createdAt);
  assert.equal(normalizeSoulmateProfile(profile, now).daysTogether, 9);
});

test('stage progress and prompt data expose only compact personality context', () => {
  const profile = { ...createSoulmateProfile({ name: '星澜' }, 1000), bond: 40 };
  const progress = stageProgress(profile);
  assert.equal(progress.stage.id, 'seed');
  assert.equal(progress.progress, 0.5);
  const prompt = soulmatePromptProfile(profile);
  assert.equal(prompt.name, '星澜');
  assert.equal(prompt.starterId, 'cute');
  assert.equal(prompt.stage, '绒云幼体');
  assert.equal(prompt.species, '绒云兽');
  assert.ok(prompt.memories.length <= 6);
  assert.ok(!('id' in prompt));
});

test('export bundles round-trip a profile and only valid recent messages', () => {
  const now = Date.UTC(2026, 6, 28);
  const profile = createSoulmateProfile({ name: '星澜', voice: 'bright' }, now);
  const bundle = createSoulmateExportBundle(profile, [
    { role: 'system', content: 'discard me' },
    { role: 'user', content: '  今天 <很好>  ' },
    { role: 'assistant', content: '我记住了。' }
  ], now);
  assert.equal(bundle.format, 'nexora-core-companion');
  assert.equal(bundle.history.length, 2);
  assert.equal(bundle.history[0].content, '今天 很好');
  const restored = normalizeSoulmateExportBundle(bundle, now);
  assert.equal(restored.profile.name, '星澜');
  assert.equal(restored.profile.voice, 'bright');
  assert.deepEqual(restored.history, bundle.history);
});

test('import rejects foreign formats and bounds conversation history', () => {
  const profile = createSoulmateProfile({ name: '星澜' }, 1000);
  assert.equal(normalizeSoulmateExportBundle({ format: 'foreign', profile }), null);
  assert.equal(normalizeSoulmateExportBundle({ version: 0, profile }), null);
  const history = normalizeSoulmateHistory(Array.from({ length: 20 }, (_, index) => ({
    role: index % 2 ? 'assistant' : 'user',
    content: `message ${index}`
  })));
  assert.equal(history.length, 12);
  assert.equal(history[0].content, 'message 8');
});

test('pendant display uses a round 240px contract and the selected evolution stage', () => {
  const profile = createSoulmateProfile({ name: '星澜', starter: 'cool' }, 1000);
  const snapshot = createPendantDisplaySnapshot(profile, {
    state: 'listening',
    stage: 'young',
    battery: 72
  }, 1000);
  assert.equal(PENDANT_DISPLAY_SIZE, 240);
  assert.deepEqual(snapshot.display, { width: 240, height: 240, shape: 'round' });
  assert.equal(snapshot.companion.stage, 'young');
  assert.equal(snapshot.companion.pose, 'listening');
  assert.match(snapshot.companion.asset, /cool-young-listening-v1/);
  assert.deepEqual(snapshot.lights, [1, 1, 1, 1]);
});

test('phone encodes a bounded NC-01 BLE snapshot with the current growth stage', () => {
  const profile = { ...createSoulmateProfile({ name: '星澜', starter: 'beautiful' }, 1000), bond: 108 };
  const snapshot = createPendantBleSnapshot(profile, 'speaking');
  const encoded = encodePendantBleSnapshot(profile, 'speaking');
  assert.equal(PENDANT_BLE_SERVICE_UUID, 'c8a10000-5101-4e58-9a18-8f352dc80101');
  assert.equal(snapshot.name, '星澜');
  assert.equal(snapshot.stage, 'young');
  assert.equal(snapshot.state, 'speaking');
  assert.ok(encoded.byteLength <= PENDANT_BLE_MAX_BYTES);
  assert.deepEqual(JSON.parse(new TextDecoder().decode(encoded)), snapshot);
});

test('pendant display prioritizes low battery and follows the voice interaction sequence', () => {
  const profile = createSoulmateProfile({ name: '星澜' }, 1000);
  const snapshot = createPendantDisplaySnapshot(profile, { state: 'speaking', battery: 8 }, 1000);
  assert.equal(snapshot.state, 'low-power');
  assert.equal(snapshot.stateLabel, '需要充电');
  assert.equal(nextPendantInteractionState('idle'), 'affection');
  assert.equal(nextPendantInteractionState('thinking'), 'speaking');
});
