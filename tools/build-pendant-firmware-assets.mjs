import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceDirectory = path.join(root, 'soulmate', 'assets', 'starters');
const outputDirectory = path.join(root, 'hardware', 'soulmate-pendant', 'firmware', 'data', 'characters');
const reviewDirectory = path.join(root, 'output', 'pendant-firmware');
const routes = ['cute', 'cool', 'beautiful'];
const stages = ['seed', 'young', 'resonance'];
const screenSize = 240;
const background = { r: 239, g: 243, b: 242, alpha: 1 };
const bounds = {
  cute: { left: 27, top: 30, width: 186, height: 186 },
  cool: { left: 41, top: 43, width: 158, height: 158 },
  beautiful: { left: 36, top: 38, width: 168, height: 168 }
};

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function encodeNxr(raw, channels) {
  const output = Buffer.allocUnsafe(8 + screenSize * screenSize * 2);
  output.write('NXR1', 0, 'ascii');
  output.writeUInt16LE(screenSize, 4);
  output.writeUInt16LE(screenSize, 6);
  let target = 8;
  for (let pixel = 0; pixel < screenSize * screenSize; pixel += 1) {
    const source = pixel * channels;
    const red = raw[source];
    const green = raw[source + 1];
    const blue = raw[source + 2];
    const rgb565 = ((red & 0xf8) << 8) | ((green & 0xfc) << 3) | (blue >> 3);
    output.writeUInt16LE(rgb565, target);
    target += 2;
  }
  return output;
}

async function buildFrame(route, stage) {
  const sourcePath = path.join(sourceDirectory, `${route}-${stage}-v1.webp`);
  const source = await readFile(sourcePath);
  const frameBounds = bounds[route];
  const character = await sharp(source)
    .resize({
      width: frameBounds.width,
      height: frameBounds.height,
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    })
    .png()
    .toBuffer();
  const frame = sharp({
    create: {
      width: screenSize,
      height: screenSize,
      channels: 4,
      background
    }
  }).composite([{
    input: character,
    left: frameBounds.left,
    top: frameBounds.top
  }]);
  const png = await frame.clone().png().toBuffer();
  const { data, info } = await frame.raw().toBuffer({ resolveWithObject: true });
  const encoded = encodeNxr(data, info.channels);
  const file = `${route}-${stage}.nxr`;
  await writeFile(path.join(outputDirectory, file), encoded);
  return {
    id: `${route}-${stage}`,
    route,
    stage,
    file,
    width: screenSize,
    height: screenSize,
    bytes: encoded.length,
    bounds: [frameBounds.left, frameBounds.top, frameBounds.width, frameBounds.height],
    source: `soulmate/assets/starters/${route}-${stage}-v1.webp`,
    sourceSha256: sha256(source),
    outputSha256: sha256(encoded),
    png
  };
}

await mkdir(outputDirectory, { recursive: true });
await mkdir(reviewDirectory, { recursive: true });

const frames = [];
for (const route of routes) {
  for (const stage of stages) frames.push(await buildFrame(route, stage));
}

const manifest = {
  version: 1,
  format: 'NXR1',
  byteOrder: 'little-endian',
  pixelFormat: 'RGB565',
  screen: [screenSize, screenSize],
  background: '#eff3f2',
  frames: frames.map(({ png, ...frame }) => frame)
};
await writeFile(path.join(outputDirectory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

await sharp({
  create: { width: screenSize * 3, height: screenSize * 3, channels: 4, background }
}).composite(frames.map((frame, index) => ({
  input: frame.png,
  left: (index % 3) * screenSize,
  top: Math.floor(index / 3) * screenSize
}))).png().toFile(path.join(reviewDirectory, 'nc01-firmware-character-contact-sheet.png'));

console.log(`Built ${frames.length} NXR1 frames (${frames.reduce((sum, frame) => sum + frame.bytes, 0)} bytes).`);
console.log(`Review: ${path.join(reviewDirectory, 'nc01-firmware-character-contact-sheet.png')}`);
