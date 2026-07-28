import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../hardware/soulmate-pendant/', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('manifest.json', root), 'utf8'));

test('pendant kit targets the measured round display module', () => {
  assert.deepEqual(manifest.sourceHardware.officialModelBounds, [36.523, 39.512, 7.9]);
  assert.equal(manifest.sourceHardware.displayDiameter, 32.4);
  assert.equal(manifest.design.displayOpening, 33.2);
  assert.ok(manifest.design.boardCavityClearance.every((value) => value >= 0.8));
});

test('pendant exports one body and three closed printable faceplates', async () => {
  const parts = Object.entries(manifest.printParts);
  assert.equal(parts.length, 4);
  assert.deepEqual(
    parts.map(([name]) => name),
    ['soulmate-pendant-body', 'soulmate-face-cute', 'soulmate-face-cool', 'soulmate-face-beautiful']
  );
  for (const [name, part] of parts) {
    assert.equal(part.openEdges, 0, `${name} has open edges`);
    assert.equal(part.nonManifoldEdges, 0, `${name} has non-manifold edges`);
    assert.ok(part.triangles > 1000, `${name} is unexpectedly coarse`);
    assert.ok(part.estimatedPlaWeightGrams > 0);
    const file = await stat(new URL(`stl/${name}.stl`, root));
    assert.ok(file.size > 50_000, `${name} STL is unexpectedly small`);
  }
});

test('pendant kit includes a slicer-ready 3MF plate and source model', async () => {
  assert.ok((await stat(new URL('soulmate-pendant-kit.3mf', root))).size > 20_000);
  assert.ok((await stat(new URL('source/soulmate-pendant.scad', root))).size > 4_000);
});
