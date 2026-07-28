import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const archiveRoot = join(root, 'meshy_output');
const publicRoot = join(root, 'NEXORA_3D_CREATURES');
const manifestPath = join(publicRoot, 'asset-manifest.json');
const cli = join(root, 'node_modules', '.bin', 'gltf-transform');

const archive = readdirSync(archiveRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && entry.name.includes('nexora-evolution-forms'))
  .map((entry) => join(archiveRoot, entry.name))
  .sort()
  .at(-1);

if (!archive || !existsSync(cli) || !existsSync(manifestPath)) {
  throw new Error('Evolution archive, glTF Transform CLI, or asset manifest is missing.');
}

const creatures = [
  { id: 'cute', source: 'cute', target: 'CUTE_LUMO' },
  { id: 'cool', source: 'cool', target: 'COOL_VEYR' },
  { id: 'beautiful', source: 'beautiful', target: 'BEAUTIFUL_AERA' }
];
const stages = ['young', 'resonance'];
const assets = [
  ['model.glb', 'model'],
  ['rigged.glb', 'rigged']
];

function optimize(input, output) {
  mkdirSync(dirname(output), { recursive: true });
  const temp = join(dirname(output), `.${basename(output)}.tmp.glb`);
  rmSync(temp, { force: true });
  const result = spawnSync(cli, [
    'optimize', input, temp,
    '--compress', 'meshopt',
    '--flatten', 'false',
    '--join', 'false',
    '--simplify', 'false',
    '--texture-compress', 'webp',
    '--texture-size', '1024'
  ], { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) {
    rmSync(temp, { force: true });
    throw new Error(result.stderr || result.stdout || `Optimization failed: ${input}`);
  }
  renameSync(temp, output);
}

function describe(file, type) {
  const content = readFileSync(file);
  return {
    type,
    path: relative(root, file),
    bytes: statSync(file).size,
    sha256: createHash('sha256').update(content).digest('hex')
  };
}

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
manifest.version = 2;
manifest.generatedAt = new Date().toISOString();
manifest.evolutionSourceArchive = relative(root, archive);

for (const creature of creatures) {
  const entry = manifest.creatures[creature.id];
  entry.forms = {
    seed: {
      stage: 'seed',
      files: entry.files.filter((asset) => ['model', 'rigged'].includes(asset.type)),
      thumbnail: `NEXORA_3D_CREATURES/${creature.target}/model/thumbnail.png`
    }
  };
  for (const stage of stages) {
    const sourceDirectory = join(archive, `${creature.source}-${stage}`);
    const targetDirectory = join(publicRoot, creature.target, 'evolution', stage);
    const files = [];
    for (const [filename, type] of assets) {
      const input = join(sourceDirectory, filename);
      const output = join(targetDirectory, filename);
      if (!existsSync(input)) throw new Error(`Missing source asset: ${input}`);
      process.stdout.write(`Optimizing ${creature.id}/${stage}/${type}... `);
      optimize(input, output);
      files.push(describe(output, type));
      console.log(`${(statSync(output).size / 1024 / 1024).toFixed(2)} MB`);
    }
    entry.forms[stage] = {
      stage,
      files,
      thumbnail: `NEXORA_3D_CREATURES/${creature.target}/evolution/${stage}/thumbnail.png`
    };
  }
}

writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Evolution manifest: ${relative(root, manifestPath)}`);
