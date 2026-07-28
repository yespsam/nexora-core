import { spawnSync } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const openscad = process.env.OPENSCAD_BIN || 'openscad';
const source = fileURLToPath(new URL('../hardware/soulmate-pendant/source/soulmate-pendant.scad', import.meta.url));
const outputRoot = fileURLToPath(new URL('../hardware/soulmate-pendant/', import.meta.url));
const output = {
  stl: `${outputRoot}stl`,
  previews: `${outputRoot}previews`
};

function runOpenScad(args) {
  const result = spawnSync(openscad, args, { encoding: 'utf8' });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`OpenSCAD failed (${result.status}):\n${result.stderr || result.stdout}`);
  }
  return `${result.stdout || ''}${result.stderr || ''}`.trim();
}

function analyzeBinaryStl(buffer) {
  if (buffer.length < 84) throw new Error('STL is too small');
  const triangles = buffer.readUInt32LE(80);
  if (buffer.length !== 84 + triangles * 50) throw new Error('Invalid binary STL length');
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  const edgeCounts = new Map();
  let signedVolume = 0;
  const keyFor = (vertex) => vertex.map((value) => Math.round(value * 10000)).join(',');

  for (let triangle = 0; triangle < triangles; triangle += 1) {
    const offset = 84 + triangle * 50 + 12;
    const vertices = [];
    for (let vertex = 0; vertex < 3; vertex += 1) {
      const point = [];
      for (let axis = 0; axis < 3; axis += 1) {
        const value = buffer.readFloatLE(offset + vertex * 12 + axis * 4);
        if (!Number.isFinite(value)) throw new Error('STL contains a non-finite coordinate');
        min[axis] = Math.min(min[axis], value);
        max[axis] = Math.max(max[axis], value);
        point.push(value);
      }
      vertices.push(point);
    }
    const [a, b, c] = vertices;
    signedVolume += (
      a[0] * (b[1] * c[2] - b[2] * c[1])
      - a[1] * (b[0] * c[2] - b[2] * c[0])
      + a[2] * (b[0] * c[1] - b[1] * c[0])
    ) / 6;
    const keys = vertices.map(keyFor);
    for (const [first, second] of [[0, 1], [1, 2], [2, 0]]) {
      const edge = [keys[first], keys[second]].sort().join('|');
      edgeCounts.set(edge, (edgeCounts.get(edge) || 0) + 1);
    }
  }

  const edgeValues = [...edgeCounts.values()];
  return {
    triangles,
    bounds: min.map((value, axis) => Number((max[axis] - value).toFixed(3))),
    min: min.map((value) => Number(value.toFixed(3))),
    max: max.map((value) => Number(value.toFixed(3))),
    volumeMm3: Number(Math.abs(signedVolume).toFixed(1)),
    openEdges: edgeValues.filter((count) => count === 1).length,
    nonManifoldEdges: edgeValues.filter((count) => count > 2).length
  };
}

async function exportStl(part, filename, directory = output.stl) {
  const path = `${directory}/${filename}.stl`;
  runOpenScad(['--export-format', 'binstl', '-D', `part="${part}"`, '-o', path, source]);
  const analysis = analyzeBinaryStl(await readFile(path));
  if (analysis.openEdges || analysis.nonManifoldEdges) {
    throw new Error(`${filename} is not manifold (${analysis.openEdges} open, ${analysis.nonManifoldEdges} non-manifold edges)`);
  }
  return analysis;
}

async function renderPreview(part, filename, camera = '0,0,0,58,0,28,150') {
  const path = `${output.previews}/${filename}.png`;
  runOpenScad([
    '--render', '--autocenter', '--viewall', '--projection', 'p',
    '--imgsize', '1400,1400', '--colorscheme', 'Tomorrow',
    '--camera', camera, '-D', `part="${part}"`, '-o', path, source
  ]);
}

await rm(`${outputRoot}obj`, { recursive: true, force: true });
for (const path of Object.values(output)) {
  await rm(path, { recursive: true, force: true });
  await mkdir(path, { recursive: true });
}

const printParts = [
  ['body', 'soulmate-pendant-body', 'Universal electronics shell'],
  ['face-cute', 'soulmate-face-cute', 'Cloud companion faceplate'],
  ['face-cool', 'soulmate-face-cool', 'Shadow companion faceplate'],
  ['face-beautiful', 'soulmate-face-beautiful', 'Moon-feather companion faceplate']
];
const manifest = {
  version: 1,
  units: 'millimeter',
  sourceHardware: {
    name: 'Waveshare ESP32-S3-LCD-1.28',
    officialModelBounds: [36.523, 39.512, 7.9],
    displayDiameter: 32.4,
    url: 'https://www.waveshare.com/wiki/ESP32-S3-LCD-1.28'
  },
  design: {
    mainBodyWithoutLoop: [46.8, 48.8, 15.2],
    displayOpening: 33.2,
    serviceBay: [31.5, 28, 5.8],
    lanyardHole: 4.8,
    faceplateThickness: 2,
    boardCavityClearance: [0.877, 1.088]
  },
  printParts: {}
};

for (const [part, filename, label] of printParts) {
  const analysis = await exportStl(part, filename);
  manifest.printParts[filename] = {
    label,
    ...analysis,
    estimatedPlaWeightGrams: Number((analysis.volumeMm3 * 0.00124).toFixed(1))
  };
}

for (const style of ['cute', 'cool', 'beautiful']) {
  await renderPreview(`assembly-${style}`, `assembly-${style}`);
}
await renderPreview('exploded-cute', 'exploded-cute', '0,0,0,62,0,30,175');
await renderPreview('shell-open', 'shell-open', '0,0,0,62,0,32,155');

runOpenScad(['-D', 'part="print-plate"', '-o', `${outputRoot}soulmate-pendant-kit.3mf`, source]);
await writeFile(`${outputRoot}manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`);

console.log(`Built ${printParts.length} manifold STL files and three assembly previews.`);
