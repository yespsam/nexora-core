import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import sharp from 'sharp';

import {
  pendantPoseAsset,
  pendantPoseAssets,
  pendantPoseIds,
  poseForPendantState
} from '../shared/pendant-poses.mjs';

const root = new URL('../soulmate/assets/starters/poses/', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('manifest.json', root), 'utf8'));

test('pendant pose library covers every route, stage and interaction', async () => {
  assert.deepEqual(manifest.routes, ['cute', 'cool', 'beautiful']);
  assert.deepEqual(manifest.stages, ['seed', 'young', 'resonance']);
  assert.deepEqual(manifest.poses, pendantPoseIds);
  assert.equal(manifest.frames.length, 54);
  assert.equal(new Set(manifest.frames.map((frame) => frame.id)).size, 54);

  for (const frame of manifest.frames) {
    const file = new URL(frame.filename, root);
    assert.ok((await stat(file)).size > 5_000, `${frame.id} is unexpectedly small`);
    const metadata = await sharp(fileURLToPath(file)).metadata();
    assert.equal(metadata.width, 384);
    assert.equal(metadata.height, 384);
    assert.equal(metadata.format, 'webp');
    assert.equal(metadata.hasAlpha, true);
  }
});

test('display states select deterministic native character poses', () => {
  assert.equal(poseForPendantState('affection'), 'affection');
  assert.equal(poseForPendantState('listening'), 'listening');
  assert.equal(poseForPendantState('thinking'), 'thinking');
  assert.equal(poseForPendantState('speaking'), 'speaking');
  assert.equal(poseForPendantState('happy'), 'happy');
  assert.equal(poseForPendantState('notice'), 'happy');
  assert.equal(poseForPendantState('charging'), 'idle');
  assert.match(pendantPoseAsset('beautiful', 'resonance', 'happy'), /beautiful-resonance-happy-v1\.webp$/);
  assert.equal(pendantPoseAssets('cute', 'young').length, 6);
});
