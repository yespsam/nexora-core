import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SUPPORTED_ACTIONS,
  companionProfiles,
  creatureKind,
  creatureProfiles,
  creatureVoiceResources,
  interactionScenes,
  personaKind,
  voiceResources
} from '../shared/companion-data.mjs';

test('shared companion catalog has complete persona records', () => {
  assert.deepEqual(Object.keys(companionProfiles).sort(), ['female', 'male']);
  assert.equal(personaKind(companionProfiles.female.id), 'female');
  assert.equal(personaKind(companionProfiles.male.id), 'male');
  assert.notEqual(companionProfiles.female.name, companionProfiles.male.name);
});

test('three creature routes own distinct identities and conversation styles', () => {
  assert.deepEqual(Object.keys(creatureProfiles), ['cute', 'cool', 'beautiful']);
  assert.equal(creatureKind('creature:cute'), 'cute');
  assert.equal(creatureKind('VEYR / 维尔'), 'cool');
  assert.equal(creatureKind('月羽灵'), 'beautiful');
  for (const profile of Object.values(creatureProfiles)) {
    assert.match(profile.id, /^creature_/);
    assert.ok(profile.speechStyle);
    assert.ok(profile.thinkingStyle);
    assert.deepEqual(Object.keys(profile.sceneReplies), ['daily', 'walk', 'focus', 'comfort', 'goodnight', 'miss']);
    assert.ok(Object.values(profile.sceneReplies).every((replies) => replies.length >= 2));
  }
});

test('creature voices are route-matched and never use the previous female cast', () => {
  assert.deepEqual(creatureVoiceResources.map((voice) => voice.starter), ['cute', 'cool', 'beautiful']);
  assert.deepEqual(creatureVoiceResources.map((voice) => voice.archetype), ['sprout', 'edge', 'aether']);
  creatureVoiceResources.forEach((voice) => {
    assert.match(voice.voice, /^zh-CN-Yun/);
    assert.doesNotMatch(voice.voice, /Xiaoxiao|Xiaoyi/);
  });
});

test('every interaction scene supports both companions', () => {
  const ids = new Set();
  for (const scene of interactionScenes) {
    assert.ok(!ids.has(scene.id), `duplicate scene id: ${scene.id}`);
    ids.add(scene.id);
    assert.ok(SUPPORTED_ACTIONS.includes(scene.action));
    assert.ok(SUPPORTED_ACTIONS.includes(scene.replyAction));
    for (const kind of ['female', 'male']) {
      assert.ok(scene.opening[kind]);
      assert.ok(scene.replies[kind].length >= 2);
      assert.ok(scene.thinking[kind].length >= 2);
    }
  }
});

test('voice archetypes are unique within each companion', () => {
  for (const kind of ['female', 'male']) {
    const ids = voiceResources[kind].map((voice) => voice.id);
    const archetypes = voiceResources[kind].map((voice) => voice.archetype);
    assert.equal(new Set(ids).size, ids.length);
    assert.equal(new Set(archetypes).size, archetypes.length);
    voiceResources[kind].forEach((voice) => assert.match(voice.voice, /^zh-CN-/));
  }
});
