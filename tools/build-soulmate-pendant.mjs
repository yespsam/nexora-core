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

function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} failed (${result.status}):\n${result.stderr || result.stdout}`);
  }
}

function analyzeBinaryStl(buffer) {
  if (buffer.length < 84) throw new Error('STL is too small');
  const triangles = buffer.readUInt32LE(80);
  if (buffer.length !== 84 + triangles * 50) throw new Error('Invalid binary STL length');
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  const edgeCounts = new Map();
  const edgeOwners = new Map();
  const parents = Array.from({ length: triangles }, (_, index) => index);
  let signedVolume = 0;
  const keyFor = (vertex) => vertex.map((value) => Math.round(value * 10000)).join(',');
  const find = (index) => {
    let root = index;
    while (parents[root] !== root) root = parents[root];
    while (parents[index] !== index) {
      const next = parents[index];
      parents[index] = root;
      index = next;
    }
    return root;
  };
  const join = (first, second) => {
    const firstRoot = find(first);
    const secondRoot = find(second);
    if (firstRoot !== secondRoot) parents[secondRoot] = firstRoot;
  };

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
      const owner = edgeOwners.get(edge);
      if (owner === undefined) edgeOwners.set(edge, triangle);
      else join(triangle, owner);
    }
  }

  const edgeValues = [...edgeCounts.values()];
  const shells = new Set(parents.map((_, index) => find(index))).size;
  return {
    triangles,
    shells,
    bounds: min.map((value, axis) => Number((max[axis] - value).toFixed(3))),
    min: min.map((value) => Number(value.toFixed(3))),
    max: max.map((value) => Number(value.toFixed(3))),
    volumeMm3: Number(Math.abs(signedVolume).toFixed(1)),
    openEdges: edgeValues.filter((count) => count === 1).length,
    nonManifoldEdges: edgeValues.filter((count) => count > 2).length
  };
}

async function exportStl(part, filename, directory = output.stl, expectedShells = 1) {
  const path = `${directory}/${filename}.stl`;
  runOpenScad(['--export-format', 'binstl', '-D', `part="${part}"`, '-o', path, source]);
  const analysis = analyzeBinaryStl(await readFile(path));
  if (analysis.openEdges || analysis.nonManifoldEdges || analysis.shells !== expectedShells) {
    throw new Error(`${filename} failed mesh checks (${analysis.shells} shells, ${analysis.openEdges} open, ${analysis.nonManifoldEdges} non-manifold edges)`);
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
await rm(output.stl, { recursive: true, force: true });
await mkdir(output.stl, { recursive: true });
await mkdir(output.previews, { recursive: true });

const stalePreviews = [
  'assembly-cute.png', 'assembly-cool.png', 'assembly-beautiful.png',
  'exploded-cute.png', 'shell-open.png',
  'nexora-core-assembly.png', 'nexora-core-exploded.png',
  'nexora-core-front.png', 'nexora-core-shell.png', 'nexora-core-rear.png'
];
for (const filename of stalePreviews) {
  await rm(`${output.previews}/${filename}`, { force: true });
}

for (const legacyArtifact of ['soulmate-pendant-kit.3mf', 'soulmate-pendant-print-pack.zip']) {
  await rm(`${outputRoot}${legacyArtifact}`, { force: true });
}

const printParts = [
  ['body', 'nexora-core-body', 'Faceted electronics shell', 1],
  ['front-frame', 'nexora-core-front-frame', 'Octagonal display frame with rear screw posts', 1],
  ['light-guide', 'nexora-core-light-guide', 'Four-piece translucent status light guide set', 4]
];
const manifest = {
  version: 2,
  product: {
    brand: 'NEXORA',
    name: 'NEXORA CORE',
    model: 'NC-01',
    designLanguage: 'faceted-shield'
  },
  units: 'millimeter',
  sourceHardware: {
    name: 'Waveshare ESP32-S3-LCD-1.28',
    officialModelBounds: [36.523, 39.512, 7.9],
    displayDiameter: 32.4,
    url: 'https://www.waveshare.com/wiki/ESP32-S3-LCD-1.28'
  },
  design: {
    outerEnvelope: [50, 67, 17],
    bodyDepth: 14.8,
    displayOpening: 33.2,
    serviceBay: [31.5, 28, 5.8],
    lanyardHole: 4.8,
    frontFrameThickness: 2.2,
    lightGuideSegments: 4,
    fastenerAccess: 'rear',
    frontFastenersVisible: false,
    boardCavityClearance: [0.877, 1.088],
    assemblyClearances: {
      framePostDiametral: 0.36,
      lightGuideOuterRadial: 0.18,
      lightGuideInnerRadial: 0.12,
      screwBossWall: 2.18,
      lanyardTopLigament: 2.2
    }
  },
  printParts: {}
};

for (const [part, filename, label, expectedShells] of printParts) {
  const analysis = await exportStl(part, filename, output.stl, expectedShells);
  manifest.printParts[filename] = {
    label,
    expectedShells,
    ...analysis,
    estimatedPlaWeightGrams: Number((analysis.volumeMm3 * 0.00124).toFixed(1))
  };
}

await renderPreview('assembly', 'nexora-core-assembly', '0,0,0,60,0,28,165');
await renderPreview('exploded', 'nexora-core-exploded', '0,0,0,62,0,28,205');
await renderPreview('assembly', 'nexora-core-front', '0,0,0,0,0,0,155');
await renderPreview('shell-open', 'nexora-core-shell', '0,0,0,62,0,30,165');
await renderPreview('assembly', 'nexora-core-rear', '0,0,0,180,0,180,155');

const kitFilename = 'nexora-core-nc01-kit.3mf';
const packFilename = 'nexora-core-nc01-print-pack.zip';
runOpenScad(['-D', 'part="print-plate"', '-o', `${outputRoot}${kitFilename}`, source]);
await writeFile(`${outputRoot}manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`);

await rm(`${outputRoot}${packFilename}`, { force: true });
runCommand('zip', [
  '-qr', packFilename,
  'README.md', 'manifest.json', 'source', 'stl', kitFilename
], { cwd: outputRoot });

console.log(`Built ${printParts.length} validated manifold NC-01 STL files, five previews, a 3MF plate, and a ZIP pack.`);
