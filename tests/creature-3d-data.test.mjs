import test from 'node:test';
import assert from 'node:assert/strict';
import {
  creature3DCatalog,
  creature3DEntry,
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

test('dialogue actions map to native creature animations', () => {
  assert.equal(creatureActionForResponse.heart, 'affection');
  assert.equal(creatureActionForResponse.voice, 'speaking');
  assert.equal(creatureActionForResponse.nod, 'nod');
  assert.equal(creatureActionForResponse.walk, 'walk');
});
