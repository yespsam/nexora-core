import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../hardware/soulmate-pendant/', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('manifest.json', root), 'utf8'));

test('NEXORA CORE targets the measured round display module', () => {
  assert.equal(manifest.product.name, 'NEXORA CORE');
  assert.equal(manifest.product.model, 'NC-01');
  assert.equal(manifest.product.designLanguage, 'faceted-shield');
  assert.deepEqual(manifest.sourceHardware.officialModelBounds, [36.523, 39.512, 7.9]);
  assert.equal(manifest.sourceHardware.displayDiameter, 32.4);
  assert.deepEqual(manifest.sourceHardware.resolution, [240, 240]);
  assert.equal(manifest.sourceHardware.displayDriver, 'GC9A01A');
  assert.equal(manifest.sourceHardware.touch, false);
  assert.equal(manifest.sourceHardware.imu, 'QMI8658');
  assert.equal(manifest.design.displayOpening, 33.2);
  assert.ok(manifest.design.boardCavityClearance.every((value) => value >= 0.8));
});

test('NC-01 hides front fasteners and includes a segmented light guide', () => {
  assert.equal(manifest.design.fastenerAccess, 'rear');
  assert.equal(manifest.design.frontFastenersVisible, false);
  assert.equal(manifest.design.lightGuideSegments, 4);
  assert.deepEqual(manifest.design.outerEnvelope, [50, 67, 17]);
  const clearances = manifest.design.assemblyClearances;
  assert.ok(clearances.framePostDiametral >= 0.25 && clearances.framePostDiametral <= 0.5);
  assert.ok(clearances.lightGuideOuterRadial >= 0.12 && clearances.lightGuideOuterRadial <= 0.3);
  assert.ok(clearances.lightGuideInnerRadial >= 0.1 && clearances.lightGuideInnerRadial <= 0.3);
  assert.ok(clearances.screwBossWall >= 2);
  assert.ok(clearances.lanyardTopLigament >= 2);
});

test('pendant exports three closed functional print parts', async () => {
  const parts = Object.entries(manifest.printParts);
  assert.equal(parts.length, 3);
  assert.deepEqual(
    parts.map(([name]) => name),
    ['nexora-core-body', 'nexora-core-front-frame', 'nexora-core-light-guide']
  );
  for (const [name, part] of parts) {
    assert.equal(part.shells, part.expectedShells, `${name} has an unexpected shell count`);
    assert.equal(part.openEdges, 0, `${name} has open edges`);
    assert.equal(part.nonManifoldEdges, 0, `${name} has non-manifold edges`);
    assert.ok(part.triangles > 200, `${name} is unexpectedly coarse`);
    assert.ok(part.estimatedPlaWeightGrams > 0);
    const file = await stat(new URL(`stl/${name}.stl`, root));
    assert.ok(file.size > 20_000, `${name} STL is unexpectedly small`);
  }
});

test('pendant kit includes a slicer-ready 3MF plate and source model', async () => {
  assert.ok((await stat(new URL('nexora-core-nc01-kit.3mf', root))).size > 20_000);
  assert.ok((await stat(new URL('nexora-core-nc01-print-pack.zip', root))).size > 50_000);
  assert.ok((await stat(new URL('source/soulmate-pendant.scad', root))).size > 4_000);
});

test('NC-01 firmware has a BLE contract and nine RGB565 character frames', async () => {
  const contract = JSON.parse(await readFile(new URL('display/display-contract.json', root), 'utf8'));
  const firmwareManifest = JSON.parse(await readFile(new URL('firmware/data/characters/manifest.json', root), 'utf8'));
  const platformio = await readFile(new URL('firmware/platformio.ini', root), 'utf8');
  assert.equal(contract.phoneSnapshot.transport, 'BLE GATT');
  assert.match(contract.phoneSnapshot.serviceUuid, /^[0-9a-f-]{36}$/);
  assert.equal(contract.phoneSnapshot.maximumBytes, 384);
  assert.match(platformio, /GC9A01_DRIVER=1/);
  assert.match(platformio, /TFT_BL=40/);
  assert.equal(firmwareManifest.format, 'NXR1');
  assert.equal(firmwareManifest.frames.length, 9);
  assert.deepEqual(new Set(firmwareManifest.frames.map((frame) => frame.route)), new Set(['cute', 'cool', 'beautiful']));
  assert.deepEqual(new Set(firmwareManifest.frames.map((frame) => frame.stage)), new Set(['seed', 'young', 'resonance']));
  for (const frame of firmwareManifest.frames) {
    assert.equal(frame.bytes, 8 + 240 * 240 * 2);
    const file = await readFile(new URL(`firmware/data/characters/${frame.file}`, root));
    assert.equal(file.subarray(0, 4).toString('ascii'), 'NXR1');
    assert.equal(file.readUInt16LE(4), 240);
    assert.equal(file.readUInt16LE(6), 240);
    assert.equal(file.length, frame.bytes);
  }
});
