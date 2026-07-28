import sharp from 'sharp';
import { fileURLToPath } from 'node:url';

const routes = [
  {
    id: 'cute',
    input: 'cute-evolution-sheet-v1.png',
    crops: [
      { id: 'seed', left: 0, top: 0, width: 520, height: 887 },
      { id: 'young', left: 500, top: 0, width: 660, height: 887 },
      { id: 'resonance', left: 1140, top: 0, width: 634, height: 887 }
    ]
  },
  {
    id: 'cool',
    input: 'cool-evolution-sheet-v1.png',
    crops: [
      { id: 'seed', left: 0, top: 0, width: 520, height: 839 },
      { id: 'young', left: 500, top: 0, width: 750, height: 839 },
      { id: 'resonance', left: 1230, top: 0, width: 644, height: 839 }
    ]
  },
  {
    id: 'beautiful',
    input: 'beautiful-evolution-sheet-v1.png',
    crops: [
      { id: 'seed', left: 0, top: 0, width: 360, height: 916 },
      { id: 'young', left: 340, top: 0, width: 680, height: 916 },
      { id: 'resonance', left: 980, top: 0, width: 737, height: 916 }
    ]
  }
];

const assetPath = (name) => fileURLToPath(new URL(`../soulmate/assets/starters/${name}`, import.meta.url));
const publicAssetPath = (name) => fileURLToPath(new URL(`../soulmate/assets/${name}`, import.meta.url));

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

async function removeChroma(path) {
  const { data, info } = await sharp(path)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  for (let index = 0; index < data.length; index += 4) {
    const red = data[index];
    const green = data[index + 1];
    const blue = data[index + 2];
    const maxRedBlue = Math.max(red, blue);
    const dominance = green - maxRedBlue;
    if (green < 80 || dominance < 8) continue;
    const removal = clamp((dominance - 8) / 48, 0, 1);
    data[index + 3] = Math.round(data[index + 3] * (1 - removal));
    data[index + 1] = Math.min(green, maxRedBlue);
    if (data[index + 3] < 8) data[index + 3] = 0;
  }

  return sharp(data, {
    raw: {
      width: info.width,
      height: info.height,
      channels: 4
    }
  }).png().toBuffer();
}

for (const route of routes) {
  const transparent = await removeChroma(assetPath(route.input));
  await sharp(transparent)
    .webp({ quality: 92, alphaQuality: 100 })
    .toFile(assetPath(`${route.id}-evolution-sheet-v1.webp`));

  for (const stage of route.crops) {
    const cropped = await sharp(transparent).extract(stage).png().toBuffer();
    const stageBuffer = await sharp(cropped)
      .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .resize(720, 720, {
        fit: 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 0 }
      })
      .webp({ quality: 92, alphaQuality: 100 })
      .toBuffer();
    await sharp(stageBuffer).toFile(assetPath(`${route.id}-${stage.id}-v1.webp`));

    if (route.id === 'cute' && stage.id === 'seed') {
      for (const size of [192, 512]) {
        await sharp(stageBuffer)
          .resize(size, size, { fit: 'contain', background: { r: 244, g: 246, b: 243, alpha: 1 } })
          .png({ compressionLevel: 9 })
          .toFile(publicAssetPath(`soulmate-icon-${size}.png`));
      }
    }
  }
}

console.log(`Processed ${routes.length} starter routes and ${routes.length * 3} evolution stages.`);
