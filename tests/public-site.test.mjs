import assert from 'node:assert/strict';
import { access, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { buildPublicSite, publicRoot } from '../tools/build-public-site.mjs';

async function listFiles(directory, prefix = '') {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const relativePath = path.join(prefix, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(path.join(directory, entry.name), relativePath));
    else files.push(relativePath);
  }
  return files;
}

test('public build contains only the product runtime allowlist', async () => {
  const result = await buildPublicSite();
  const files = await listFiles(result.output);

  for (const requiredPath of [
    'index.html',
    'soulmate/index.html',
    'pendant-display/index.html',
    'shared/creature-3d-viewer.mjs',
    'NEXORA_3D_CREATURES/CUTE_LUMO/model/rigged.glb',
    'NEXORA_3D_CREATURES/COOL_VEYR/evolution/young/rigged.glb',
    'NEXORA_3D_CREATURES/BEAUTIFUL_AERA/evolution/resonance/rigged.glb'
  ]) {
    await access(path.join(publicRoot, requiredPath));
  }

  for (const forbiddenPath of [
    'README.md',
    'QUICK_START.md',
    'package.json',
    'LICENSE',
    'docs',
    'hardware',
    'tests',
    'tools',
    'device-lab',
    'videos',
    'ai-companion'
  ]) {
    await assert.rejects(access(path.join(publicRoot, forbiddenPath)));
  }

  assert.equal(files.some((file) => /\.(?:md|zip|3mf|cpp|h|scad)$/i.test(file)), false);
  assert.equal(files.some((file) => /(?:^|\/)(?:reference|metadata)(?:\/|\.|$)|asset-manifest/i.test(file)), false);

  const rootHtml = await readFile(path.join(publicRoot, 'index.html'), 'utf8');
  assert.match(rootHtml, /\.\/soulmate\//);

  const pendantHtml = await readFile(path.join(publicRoot, 'pendant-display/index.html'), 'utf8');
  assert.doesNotMatch(pendantHtml, /device-lab/);
});
