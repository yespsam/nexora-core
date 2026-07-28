import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const creatures = [
  {
    directory: 'CUTE_LUMO',
    source: 'lumo-turnaround-v1.png',
    cuts: [0, 565, 1150, 1693]
  },
  {
    directory: 'COOL_VEYR',
    source: 'veyr-turnaround-v1.png',
    cuts: [0, 560, 1220, 1691]
  },
  {
    directory: 'BEAUTIFUL_AERA',
    source: 'aera-turnaround-v1.png',
    cuts: [0, 610, 1200, 1734]
  }
];
const viewNames = ['front', 'side', 'back'];

for (const creature of creatures) {
  const referenceDirectory = path.join(root, 'NEXORA_3D_CREATURES', creature.directory, 'reference');
  const source = path.join(referenceDirectory, creature.source);
  const metadata = await sharp(source).metadata();
  if (creature.cuts.at(-1) !== metadata.width) {
    throw new Error(`${creature.source} width changed; update the view cuts`);
  }
  await mkdir(referenceDirectory, { recursive: true });

  for (let index = 0; index < viewNames.length; index += 1) {
    const left = creature.cuts[index];
    const width = creature.cuts[index + 1] - left;
    const view = await sharp(source)
      .extract({ left, top: 0, width, height: metadata.height })
      .png()
      .toBuffer();
    const subject = await sharp(view)
      .trim({ background: '#ffffff', threshold: 6 })
      .resize(900, 900, {
        fit: 'contain',
        background: { r: 255, g: 255, b: 255, alpha: 1 }
      })
      .png()
      .toBuffer();
    await sharp({
      create: {
        width: 1024,
        height: 1024,
        channels: 4,
        background: { r: 255, g: 255, b: 255, alpha: 1 }
      }
    }).composite([{ input: subject, left: 62, top: 62 }])
      .png()
      .toFile(path.join(referenceDirectory, `${viewNames[index]}.png`));
  }
}

console.log('Prepared front, side and back references for 3 NEXORA creatures.');
