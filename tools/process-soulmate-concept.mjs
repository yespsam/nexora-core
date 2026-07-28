import sharp from 'sharp';
import { fileURLToPath } from 'node:url';

const input = fileURLToPath(new URL('../soulmate/assets/soulmate-evolution-sheet-v1.png', import.meta.url));
const outputUrl = (name) => fileURLToPath(new URL(`../soulmate/assets/${name}`, import.meta.url));

const stages = [
  { id: 'seed', left: 20, top: 135, width: 500, height: 650 },
  { id: 'young', left: 500, top: 75, width: 520, height: 760 },
  { id: 'resonance', left: 995, top: 25, width: 826, height: 825 }
];

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

async function removeChroma(source) {
  const { data, info } = await sharp(source)
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
  });
}

const transparent = await removeChroma(input);
const transparentBuffer = await transparent.png().toBuffer();
await sharp(transparentBuffer)
  .webp({ quality: 92, alphaQuality: 100 })
  .toFile(outputUrl('soulmate-evolution-sheet-v1.webp'));

for (const stage of stages) {
  const cropBuffer = await sharp(transparentBuffer)
    .extract(stage)
    .png()
    .toBuffer();
  const stageBuffer = await sharp(cropBuffer)
    .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .resize(720, 720, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    })
    .webp({ quality: 92, alphaQuality: 100 })
    .toBuffer();
  await sharp(stageBuffer).toFile(outputUrl(`soulmate-${stage.id}-v1.webp`));
  if (stage.id === 'seed') {
    for (const size of [192, 512]) {
      await sharp(stageBuffer)
        .resize(size, size, { fit: 'contain', background: { r: 244, g: 246, b: 243, alpha: 1 } })
        .png({ compressionLevel: 9 })
        .toFile(outputUrl(`soulmate-icon-${size}.png`));
    }
  }
}

console.log(`Processed ${stages.length} Soulmate evolution stages.`);
