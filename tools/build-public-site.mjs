import { copyFile, mkdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const toolFile = fileURLToPath(import.meta.url);
export const repositoryRoot = path.resolve(path.dirname(toolFile), '..');
export const publicRoot = path.join(repositoryRoot, 'public');

const publicFiles = [
  'index.html',
  'access/index.html',
  'access/app.js',
  'access/style.css',
  'soulmate/index.html',
  'soulmate/app.js',
  'soulmate/style.css',
  'soulmate/sw.js',
  'soulmate/manifest.webmanifest',
  'soulmate/assets/soulmate-icon-192.png',
  'soulmate/assets/soulmate-icon-512.png',
  'desktop-wallpaper/index.html',
  'pendant-display/index.html',
  'pendant-display/app.js',
  'pendant-display/style.css',
  'shared/soulmate-profile.mjs',
  'shared/soulmate-memory.mjs',
  'shared/soulmate-resilience.mjs',
  'shared/chat-stream.mjs',
  'shared/device-command.mjs',
  'shared/device-command-cloud.mjs',
  'shared/soulmate-command-agent.mjs',
  'shared/soulmate-sync.mjs',
  'shared/soulmate-cloud-sync.mjs',
  'shared/soulmate-device-cloud.mjs',
  'shared/device-cloud-crypto.mjs',
  'shared/device-cloud-protocol.mjs',
  'shared/pendant-ble.mjs',
  'shared/pendant-simulator.mjs',
  'shared/pendant-display.mjs',
  'shared/pendant-poses.mjs',
  'shared/creature-3d-data.mjs',
  'shared/creature-3d-viewer.mjs',
  'shared/voice-turn.mjs',
  'desktop-wallpaper/vendor/three.module.js',
  'desktop-wallpaper/vendor/GLTFLoader.js',
  'desktop-wallpaper/vendor/BufferGeometryUtils.js',
  'desktop-wallpaper/vendor/meshopt_decoder.module.js'
];

const creatureDirectories = [
  'CUTE_LUMO',
  'COOL_VEYR',
  'BEAUTIFUL_AERA'
];

const creatureRuntimeFiles = [
  'model/rigged.glb',
  'evolution/young/rigged.glb',
  'evolution/resonance/rigged.glb',
  'animations/idle.glb',
  'animations/nod.glb',
  'animations/affection.glb',
  'animations/wave.glb',
  'animations/speaking.glb',
  'animations/walk.glb',
  'animations/run.glb'
];

const notFoundPage = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="robots" content="noindex,nofollow,noarchive">
  <title>NEXORA CORE</title>
  <style>html,body{height:100%;margin:0}body{display:grid;place-items:center;background:#080b0d;color:#f3f7f7;font:600 18px system-ui,sans-serif}main{text-align:center}strong{display:block;margin-bottom:10px;color:#52e4e8;letter-spacing:3px}</style>
</head>
<body><main><strong>NEXORA CORE</strong>页面不可用</main></body>
</html>
`;

async function copyPublicFile(relativePath) {
  const source = path.join(repositoryRoot, relativePath);
  const destination = path.join(publicRoot, relativePath);
  await stat(source);
  await mkdir(path.dirname(destination), { recursive: true });
  await copyFile(source, destination);
}

export async function buildPublicSite() {
  await rm(publicRoot, { recursive: true, force: true });
  await mkdir(publicRoot, { recursive: true });

  for (const relativePath of publicFiles) {
    await copyPublicFile(relativePath);
  }

  for (const creatureDirectory of creatureDirectories) {
    for (const relativePath of creatureRuntimeFiles) {
      await copyPublicFile(path.join('NEXORA_3D_CREATURES', creatureDirectory, relativePath));
    }
  }

  await writeFile(path.join(publicRoot, '404.html'), notFoundPage, 'utf8');

  return {
    output: publicRoot,
    files: publicFiles.length + (creatureDirectories.length * creatureRuntimeFiles.length) + 1
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === toolFile) {
  const result = await buildPublicSite();
  console.log(`Built ${result.files} public runtime files in ${path.relative(repositoryRoot, result.output)}/.`);
}
