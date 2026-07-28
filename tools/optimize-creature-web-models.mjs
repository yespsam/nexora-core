import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const archiveRoot = join(root, 'meshy_output');
const publicRoot = join(root, 'NEXORA_3D_CREATURES');
const cli = join(root, 'node_modules', '.bin', 'gltf-transform');

const archive = readdirSync(archiveRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && entry.name.includes('nexora-original-3d-creatures'))
  .map((entry) => join(archiveRoot, entry.name))
  .sort()
  .at(-1);

if (!archive || !existsSync(cli)) {
  throw new Error('Meshy archive or glTF Transform CLI is missing.');
}

const creatures = [
  { id: 'cute', name: 'LUMO / 露莫', source: 'cute-lumo', target: 'CUTE_LUMO' },
  { id: 'cool', name: 'VEYR / 维尔', source: 'cool-veyr', target: 'COOL_VEYR' },
  { id: 'beautiful', name: 'AERA / 艾拉', source: 'beautiful-aera', target: 'BEAUTIFUL_AERA' }
];

const assets = [
  ['model.glb', 'model/model.glb', 'model'],
  ['rigged.glb', 'model/rigged.glb', 'rigged'],
  ['idle.glb', 'animations/idle.glb', 'idle'],
  ['nod.glb', 'animations/nod.glb', 'nod'],
  ['affection.glb', 'animations/affection.glb', 'affection'],
  ['wave.glb', 'animations/wave.glb', 'wave'],
  ['speaking.glb', 'animations/speaking.glb', 'speaking'],
  ['walk.glb', 'animations/walk.glb', 'walk'],
  ['run.glb', 'animations/run.glb', 'run']
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

const manifest = {
  version: 1,
  generatedAt: new Date().toISOString(),
  sourceArchive: relative(root, archive),
  optimization: {
    geometry: 'meshopt',
    texture: 'webp',
    maxTextureSize: 1024,
    meshSimplified: false
  },
  creatures: {}
};

for (const creature of creatures) {
  const sourceDirectory = join(archive, creature.source);
  const targetDirectory = join(publicRoot, creature.target);
  const files = [];
  for (const [sourceName, targetName, type] of assets) {
    const input = join(sourceDirectory, sourceName);
    const output = join(targetDirectory, targetName);
    if (!existsSync(input)) throw new Error(`Missing source asset: ${input}`);
    process.stdout.write(`Optimizing ${creature.id}/${type}... `);
    optimize(input, output);
    files.push(describe(output, type));
    console.log(`${(statSync(output).size / 1024 / 1024).toFixed(2)} MB`);
  }
  rmSync(join(targetDirectory, 'model', 'model.fbx'), { force: true });
  manifest.creatures[creature.id] = {
    name: creature.name,
    directory: creature.target,
    files
  };
}

writeFileSync(join(publicRoot, 'asset-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Web asset manifest: ${relative(root, join(publicRoot, 'asset-manifest.json'))}`);
