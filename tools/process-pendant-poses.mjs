import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = path.join(root, 'modeling', 'reference', 'pendant-poses');
const outputRoot = path.join(root, 'soulmate', 'assets', 'starters', 'poses');
const reviewRoot = path.join(root, 'output', 'pendant-poses');
const routes = ['cute', 'cool', 'beautiful'];
const stages = ['seed', 'young', 'resonance'];
const poses = ['idle', 'affection', 'listening', 'thinking', 'speaking', 'happy'];
const sourceCell = 512;
const outputCell = 384;
const reviewCell = 192;

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function removeEdgeFragments(data, width, height) {
  const labels = new Uint32Array(width * height);
  const queue = new Uint32Array(width * height);
  const components = [{ area: 0, touchesEdge: false, minX: 0, minY: 0, maxX: 0, maxY: 0 }];
  let componentId = 0;

  for (let start = 0; start < width * height; start += 1) {
    if (data[start * 4 + 3] < 12 || labels[start]) continue;
    componentId += 1;
    let head = 0;
    let tail = 1;
    let area = 0;
    let touchesEdge = false;
    let minX = width;
    let minY = height;
    let maxX = 0;
    let maxY = 0;
    queue[0] = start;
    labels[start] = componentId;

    while (head < tail) {
      const pixel = queue[head++];
      const x = pixel % width;
      const y = Math.floor(pixel / width);
      area += 1;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      if (x <= 1 || y <= 1 || x >= width - 2 || y >= height - 2) touchesEdge = true;
      const neighbors = [pixel - 1, pixel + 1, pixel - width, pixel + width];
      for (const neighbor of neighbors) {
        if (neighbor < 0 || neighbor >= width * height || labels[neighbor]) continue;
        const nextX = neighbor % width;
        if (Math.abs(nextX - x) > 1 || data[neighbor * 4 + 3] < 12) continue;
        labels[neighbor] = componentId;
        queue[tail++] = neighbor;
      }
    }
    components.push({ area, touchesEdge, minX, minY, maxX, maxY });
  }

  let largest = 0;
  for (let id = 1; id < components.length; id += 1) {
    if (!largest || components[id].area > components[largest].area) largest = id;
  }
  const subject = components[largest];
  const shouldRemove = components.map((component, id) => {
    if (!id || id === largest) return false;
    const dx = Math.max(0, subject.minX - component.maxX, component.minX - subject.maxX);
    const dy = Math.max(0, subject.minY - component.maxY, component.minY - subject.maxY);
    return component.touchesEdge || Math.hypot(dx, dy) > 64;
  });
  for (let pixel = 0; pixel < labels.length; pixel += 1) {
    const id = labels[pixel];
    if (id && shouldRemove[id]) data[pixel * 4 + 3] = 0;
  }
  return data;
}

await rm(outputRoot, { recursive: true, force: true });
await mkdir(outputRoot, { recursive: true });
await mkdir(reviewRoot, { recursive: true });

const frames = [];
for (const route of routes) {
  for (const stage of stages) {
    const sourceName = `${route}-${stage}-poses-transparent.png`;
    const sourcePath = path.join(sourceRoot, sourceName);
    const source = await readFile(sourcePath);
    const metadata = await sharp(source).metadata();
    if (metadata.width !== sourceCell * 3 || metadata.height !== sourceCell * 2) {
      throw new Error(`${sourceName} must be 1536x1024`);
    }

    for (let index = 0; index < poses.length; index += 1) {
      const pose = poses[index];
      const filename = `${route}-${stage}-${pose}-v1.webp`;
      const { data, info } = await sharp(source)
        .extract({
          left: (index % 3) * sourceCell,
          top: Math.floor(index / 3) * sourceCell,
          width: sourceCell,
          height: sourceCell
        })
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      const cleaned = removeEdgeFragments(data, info.width, info.height);
      const buffer = await sharp(cleaned, { raw: info })
        .resize(outputCell, outputCell, { fit: 'fill' })
        .webp({ quality: 90, alphaQuality: 100, effort: 5 })
        .toBuffer();
      await writeFile(path.join(outputRoot, filename), buffer);
      frames.push({
        id: `${route}-${stage}-${pose}`,
        route,
        stage,
        pose,
        filename,
        width: outputCell,
        height: outputCell,
        bytes: buffer.length,
        source: `modeling/reference/pendant-poses/${sourceName}`,
        sha256: sha256(buffer),
        review: await sharp(buffer).resize(reviewCell, reviewCell).png().toBuffer()
      });
    }
  }
}

const manifest = {
  version: 1,
  format: 'webp',
  cell: [outputCell, outputCell],
  routes,
  stages,
  poses,
  frames: frames.map(({ review, ...frame }) => frame)
};
await writeFile(path.join(outputRoot, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

await sharp({
  create: {
    width: poses.length * reviewCell,
    height: routes.length * stages.length * reviewCell,
    channels: 4,
    background: { r: 237, g: 241, b: 240, alpha: 1 }
  }
}).composite(frames.map((frame, index) => ({
  input: frame.review,
  left: (index % poses.length) * reviewCell,
  top: Math.floor(index / poses.length) * reviewCell
}))).png().toFile(path.join(reviewRoot, 'nc01-pose-contact-sheet.png'));

console.log(`Built ${frames.length} pendant poses (${frames.reduce((sum, frame) => sum + frame.bytes, 0)} bytes).`);
console.log(`Review: ${path.join(reviewRoot, 'nc01-pose-contact-sheet.png')}`);
