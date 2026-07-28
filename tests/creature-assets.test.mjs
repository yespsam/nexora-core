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
