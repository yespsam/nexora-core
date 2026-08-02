import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const source = resolve(root, 'soulmate/assets/soulmate-icon-512.png');
const target = resolve(root, 'windows/NexoraBridge/AppIcon.ico');
const png = await readFile(source);

// ICO supports embedded PNG data. A zero width/height byte represents 256px or larger.
const header = Buffer.alloc(22);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(1, 4);
header.writeUInt8(0, 6);
header.writeUInt8(0, 7);
header.writeUInt8(0, 8);
header.writeUInt8(0, 9);
header.writeUInt16LE(1, 10);
header.writeUInt16LE(32, 12);
header.writeUInt32LE(png.length, 14);
header.writeUInt32LE(header.length, 18);

await mkdir(dirname(target), { recursive: true });
await writeFile(target, Buffer.concat([header, png]));
console.log(target);
