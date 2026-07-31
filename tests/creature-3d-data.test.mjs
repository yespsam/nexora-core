import test from 'node:test';
import assert from 'node:assert/strict';
import {
  creature3DCatalog,
  creature3DEntry,
  creatureActionForPhase,
  creatureActionProfiles,
  creatureActionForResponse
} from '../shared/creature-3d-data.mjs';

test('3D catalog exposes nine distinct native evolution forms', () => {
  const models = new Set();
  for (const starter of Object.keys(creature3DCatalog)) {
    for (const stage of ['seed', 'young', 'resonance']) {
      const entry = creature3DEntry(starter, stage);
      assert.equal(entry.id, starter);
      assert.equal(entry.stage, stage);
      assert.match(entry.model, /\.glb$/);
      models.add(entry.model);
    }
  }
  assert.equal(models.size, 9);
});

test('evolution forms reuse the verified route skeleton action library', () => {
  for (const starter of Object.keys(creature3DCatalog)) {
    const seed = creature3DEntry(starter, 'seed');
    for (const stage of ['young', 'resonance']) {
      const evolved = creature3DEntry(starter, stage);
      assert.deepEqual(evolved.actions, seed.actions);
      assert.notEqual(evolved.model, seed.model);
    }
  }
});

test('unknown evolution stages safely resolve to the seed form', () => {
  const entry = creature3DEntry('cute', 'missing');
  assert.equal(entry.stage, 'seed');
  assert.equal(entry.model, creature3DCatalog.cute.forms.seed.model);
});

test('dialogue responses map to creature motion states', () => {
  assert.equal(creatureActionForResponse.heart, 'affection');
  assert.equal(creatureActionForResponse.voice, 'speaking');
  assert.equal(creatureActionForResponse.nod, 'nod');
  assert.equal(creatureActionForResponse.walk, 'walk');
});

test('device states use distinct coordinated motion profiles', () => {
  assert.equal(creatureActionForPhase.listening, 'listening');
  assert.equal(creatureActionForPhase.charging, 'charging');
  assert.equal(creatureActionForPhase['low-power'], 'low-power');
  assert.equal(creatureActionForPhase.sleep, 'sleep');
  for (const action of ['idle', 'listening', 'nod', 'affection', 'wave', 'speaking', 'walk', 'run']) {
    assert.equal(creatureActionProfiles[action].stabilizeYaw, true);
    assert.equal(creatureActionProfiles[action].stabilizeXZ, true);
  }
  assert.ok(creatureActionProfiles.listening.lean < 0);
  assert.ok(creatureActionProfiles.sleep.lean > creatureActionProfiles['low-power'].lean);
  for (const action of ['idle', 'listening', 'nod', 'affection', 'wave', 'charging', 'low-power', 'sleep']) {
    assert.equal(creatureActionProfiles[action].freezePose, true);
    assert.equal(creatureActionProfiles[action].procedural, action);
  }
  for (const action of ['speaking', 'walk', 'run']) {
    assert.equal(creatureActionProfiles[action].freezePose, undefined);
    assert.equal(creatureActionProfiles[action].procedural, undefined);
    assert.match(creature3DEntry('cute', 'seed').actions[action], new RegExp(`/animations/${action}\\.glb$`));
  }
  assert.match(creature3DEntry('cute', 'seed').actions.idle, /\/animations\/idle\.glb$/);
  for (const action of ['nod', 'affection', 'wave']) {
    assert.equal(creature3DEntry('cute', 'seed').actions[action], creature3DEntry('cute', 'seed').actions.idle);
  }
  for (const starter of ['cute', 'cool', 'beautiful']) {
    assert.equal(creature3DEntry(starter, 'seed').yaw, 0);
    assert.equal(creature3DEntry(starter, 'young').yaw, 0);
  }
  assert.equal(creature3DEntry('cute', 'resonance').yaw, -Math.PI / 4);
  assert.equal(creature3DEntry('cool', 'resonance').yaw, 0);
  assert.equal(creature3DEntry('beautiful', 'resonance').yaw, 0);
});
