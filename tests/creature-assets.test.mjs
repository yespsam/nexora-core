import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const manifest = JSON.parse(readFileSync(resolve(root, 'NEXORA_3D_CREATURES/asset-manifest.json'), 'utf8'));

function readGlbJson(file) {
  const data = readFileSync(file);
  assert.equal(data.toString('ascii', 0, 4), 'glTF', `${file} is not a GLB`);
  const jsonLength = data.readUInt32LE(12);
  assert.equal(data.readUInt32LE(16), 0x4e4f534a, `${file} has no JSON chunk`);
  return JSON.parse(data.toString('utf8', 20, 20 + jsonLength).trim());
}

function skinJointNames(gltf) {
  return [...new Set((gltf.skins || [])
    .flatMap((skin) => skin.joints || [])
    .map((node) => gltf.nodes[node]?.name)
    .filter(Boolean))].sort();
}

test('published creature pack contains three compact WebGL-ready characters', () => {
  assert.deepEqual(Object.keys(manifest.creatures), ['cute', 'cool', 'beautiful']);
  for (const creature of Object.values(manifest.creatures)) {
    assert.equal(creature.files.length, 9);
    for (const asset of creature.files) {
      const file = resolve(root, asset.path);
      assert.equal(statSync(file).size, asset.bytes);
      assert.ok(asset.bytes < 2 * 1024 * 1024, `${asset.path} is too large for mobile delivery`);
      const gltf = readGlbJson(file);
      assert.equal(gltf.asset.version, '2.0');
      assert.ok(gltf.meshes?.length >= 1, `${asset.path} has no mesh`);
      assert.ok(gltf.extensionsUsed?.includes('EXT_meshopt_compression'));
      if (asset.type !== 'model') assert.ok(gltf.skins?.length >= 1, `${asset.path} has no skeleton`);
      if (!['model', 'rigged'].includes(asset.type)) {
        assert.ok(gltf.animations?.length >= 1, `${asset.path} has no animation`);
      }
    }
  }
});

test('every action targets the same skeleton so clips can crossfade on one model', () => {
  for (const creature of Object.values(manifest.creatures)) {
    let expectedTargets;
    for (const asset of creature.files.filter((item) => !['model', 'rigged'].includes(item.type))) {
      const gltf = readGlbJson(resolve(root, asset.path));
      const targets = [...new Set(gltf.animations[0].channels
        .map((channel) => gltf.nodes[channel.target.node]?.name)
        .filter(Boolean))].sort();
      if (!expectedTargets) expectedTargets = targets;
      assert.deepEqual(targets, expectedTargets, `${asset.path} does not match the shared skeleton`);
    }
  }
});

test('published evolution pack contains nine compact native 3D forms', () => {
  assert.equal(manifest.version, 2);
  for (const creature of Object.values(manifest.creatures)) {
    assert.deepEqual(Object.keys(creature.forms), ['seed', 'young', 'resonance']);
    for (const [stage, form] of Object.entries(creature.forms)) {
      assert.equal(form.stage, stage);
      assert.equal(form.files.length, 2);
      for (const asset of form.files) {
        const file = resolve(root, asset.path);
        assert.equal(statSync(file).size, asset.bytes);
        assert.ok(asset.bytes < 2 * 1024 * 1024, `${asset.path} is too large for mobile delivery`);
        const gltf = readGlbJson(file);
        assert.ok(gltf.meshes?.length >= 1, `${asset.path} has no mesh`);
        assert.ok(gltf.extensionsUsed?.includes('EXT_meshopt_compression'));
        if (asset.type === 'rigged') assert.equal(skinJointNames(gltf).length, 24);
      }
    }
  }
});

test('every evolution rig matches its route action skeleton', () => {
  for (const creature of Object.values(manifest.creatures)) {
    const seedRig = creature.forms.seed.files.find((asset) => asset.type === 'rigged');
    const expected = skinJointNames(readGlbJson(resolve(root, seedRig.path)));
    for (const stage of ['young', 'resonance']) {
      const rig = creature.forms[stage].files.find((asset) => asset.type === 'rigged');
      const joints = skinJointNames(readGlbJson(resolve(root, rig.path)));
      assert.deepEqual(joints, expected, `${rig.path} cannot reuse the route actions`);
    }
  }
});
