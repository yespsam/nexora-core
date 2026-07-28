import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createSoulmateProfile,
  growSoulmate,
  normalizeSoulmateProfile,
  soulmatePromptProfile,
  stageForBond,
  stageProgress
} from '../shared/soulmate-profile.mjs';

test('creates a named Soulmate with a stable identity seed', () => {
  const profile = createSoulmateProfile({
    name: '星澜',
    birthday: '2026-07-28',
    gender: 'neutral',
    voice: 'soft',
    temperament: 'curious'
  }, Date.UTC(2026, 6, 28));
  assert.equal(profile.name, '星澜');
  assert.equal(profile.birthday, '2026-07-28');
  assert.equal(profile.traits.curiosity, 70);
  assert.equal(stageForBond(profile.bond).id, 'seed');
});

test('chat grows bond, traits, and bounded memories', () => {
  let profile = createSoulmateProfile({ name: '星澜' }, 1000);
  for (let index = 0; index < 30; index += 1) {
    profile = growSoulmate(profile, { kind: 'chat', text: `我想知道今天的第 ${index} 件事？` }, 2000 + index);
  }
  assert.equal(profile.memories.length, 24);
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
  assert.equal(prompt.stage, '灵魂种子');
  assert.ok(!('id' in prompt));
});
