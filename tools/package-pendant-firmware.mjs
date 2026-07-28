import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const buildDirectory = path.join(root, 'hardware', 'soulmate-pendant', 'firmware', '.pio', 'build', 'nc01');
const outputRoot = path.join(root, 'output', 'pendant-firmware');
const bundleDirectory = path.join(outputRoot, 'nc01-flash-bundle');
const zipPath = path.join(outputRoot, 'nexora-nc01-flash-bundle.zip');
const platformioRoot = path.join(process.env.HOME || '', '.platformio');
const esptool = path.join(platformioRoot, 'packages', 'tool-esptoolpy', 'esptool.py');
const bootAppSource = path.join(platformioRoot, 'packages', 'framework-arduinoespressif32', 'tools', 'partitions', 'boot_app0.bin');

const inputs = [
  { name: 'bootloader.bin', source: path.join(buildDirectory, 'bootloader.bin'), offset: '0x0000' },
  { name: 'partitions.bin', source: path.join(buildDirectory, 'partitions.bin'), offset: '0x8000' },
  { name: 'boot_app0.bin', source: bootAppSource, offset: '0xe000' },
  { name: 'firmware.bin', source: path.join(buildDirectory, 'firmware.bin'), offset: '0x10000' },
  { name: 'littlefs.bin', source: path.join(buildDirectory, 'littlefs.bin'), offset: '0x610000' }
];

async function sha256(file) {
  return createHash('sha256').update(await readFile(file)).digest('hex');
}

await Promise.all([esptool, ...inputs.map((input) => input.source)].map((file) => stat(file)));
await rm(bundleDirectory, { recursive: true, force: true });
await rm(zipPath, { force: true });
await mkdir(bundleDirectory, { recursive: true });
for (const input of inputs) await copyFile(input.source, path.join(bundleDirectory, input.name));

const factoryImage = path.join(bundleDirectory, 'nexora-nc01-factory.bin');
const merge = spawnSync('python3', [
  esptool,
  '--chip', 'esp32s3',
  'merge_bin',
  '-o', factoryImage,
  '--flash_mode', 'qio',
  '--flash_freq', '80m',
  '--flash_size', '16MB',
  ...inputs.flatMap((input) => [input.offset, path.join(bundleDirectory, input.name)])
], { stdio: 'inherit' });
if (merge.status !== 0) throw new Error('Unable to merge NC-01 factory image');

const artifacts = [];
for (const input of inputs) {
  const file = path.join(bundleDirectory, input.name);
  artifacts.push({ file: input.name, offset: input.offset, bytes: (await stat(file)).size, sha256: await sha256(file) });
}
artifacts.push({
  file: path.basename(factoryImage),
  offset: '0x0000',
  bytes: (await stat(factoryImage)).size,
  sha256: await sha256(factoryImage)
});

await writeFile(path.join(bundleDirectory, 'flash-manifest.json'), `${JSON.stringify({
  version: 1,
  product: 'NEXORA CORE NC-01',
  chip: 'ESP32-S3',
  flashSize: '16MB',
  artifacts
}, null, 2)}\n`);

await writeFile(path.join(bundleDirectory, 'README.txt'), [
  'NEXORA CORE NC-01 firmware prototype',
  '',
  'Factory image (erases and writes from 0x0000):',
  'python3 -m esptool --chip esp32s3 --port <PORT> erase_flash',
  'python3 -m esptool --chip esp32s3 --port <PORT> --baud 921600 write_flash 0x0000 nexora-nc01-factory.bin',
  '',
  'This image has passed local compilation and packaging only. Verify it on an unassembled bench board before wearable testing.',
  ''
].join('\n'));

const archive = spawnSync('zip', ['-qr', zipPath, path.basename(bundleDirectory)], { cwd: outputRoot });
if (archive.status !== 0) throw new Error('Unable to archive NC-01 flash bundle');
console.log(`Bundle: ${bundleDirectory}`);
console.log(`Archive: ${zipPath}`);
