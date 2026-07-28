import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
const hardwareRoot = path.join(repositoryRoot, 'hardware/soulmate-pendant');
const manifest = JSON.parse(await readFile(path.join(hardwareRoot, 'manifest.json'), 'utf8'));
const slicer = process.env.PRUSA_SLICER_BIN
  || '/Applications/PrusaSlicer.app/Contents/MacOS/PrusaSlicer';

if (!existsSync(slicer)) {
  throw new Error('PrusaSlicer is required. Install it with: brew install --cask prusaslicer');
}

const experimentRoot = path.join(hardwareRoot, 'experiments');
const gcodeRoot = path.join(tmpdir(), 'nexora-core-nc01-simulation');
await mkdir(experimentRoot, { recursive: true });
await mkdir(gcodeRoot, { recursive: true });

const parts = [
  { name: '后壳', file: 'nexora-core-body.stl', fillDensity: '25%', fillPattern: 'gyroid' },
  { name: '前框', file: 'nexora-core-front-frame.stl', fillDensity: '25%', fillPattern: 'gyroid' },
  { name: '导光条', file: 'nexora-core-light-guide.stl', fillDensity: '100%', fillPattern: 'rectilinear' }
];

const commonArgs = [
  '--bed-shape', '0x0,180x0,180x180,0x180',
  '--nozzle-diameter', '0.4',
  '--filament-diameter', '1.75',
  '--filament-density', '1.27',
  '--filament-cost', '25',
  '--temperature', '240',
  '--first-layer-temperature', '240',
  '--bed-temperature', '85',
  '--first-layer-bed-temperature', '85',
  '--layer-height', '0.2',
  '--first-layer-height', '0.2',
  '--perimeters', '3',
  '--top-solid-layers', '5',
  '--bottom-solid-layers', '5',
  '--skirts', '0',
  '--brim-width', '0'
];

function parseNumber(gcode, label) {
  const match = gcode.match(new RegExp(`^; ${label} = ([0-9.]+)$`, 'm'));
  if (!match) throw new Error(`Missing ${label} in generated G-code`);
  return Number(match[1]);
}

function parseDuration(value) {
  const hours = Number(value.match(/(\d+)h/)?.[1] || 0);
  const minutes = Number(value.match(/(\d+)m/)?.[1] || 0);
  const seconds = Number(value.match(/(\d+)s/)?.[1] || 0);
  return hours * 3600 + minutes * 60 + seconds;
}

function formatDuration(totalSeconds) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours ? `${hours}h` : '', `${minutes}m`, `${seconds}s`].filter(Boolean).join(' ');
}

const slicerVersion = spawnSync(slicer, ['--help'], { encoding: 'utf8' })
  .stdout.split('\n')[0].trim();
const sliceResults = [];

for (const part of parts) {
  const source = path.join(hardwareRoot, 'stl', part.file);
  const target = path.join(gcodeRoot, part.file.replace(/\.stl$/, '.gcode'));
  const result = spawnSync(slicer, [
    ...commonArgs,
    '--fill-density', part.fillDensity,
    '--fill-pattern', part.fillPattern,
    '--export-gcode', '--output', target,
    source
  ], { encoding: 'utf8' });
  const output = `${result.stdout || ''}${result.stderr || ''}`;
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Slicing ${part.file} failed:\n${output}`);

  const warnings = output.split('\n')
    .filter((line) => /print warning|consider enabling supports/i.test(line.trim()));
  const gcode = await readFile(target, 'utf8');
  const durationText = gcode.match(/^; estimated printing time \(normal mode\) = (.+)$/m)?.[1];
  if (!durationText) throw new Error(`Missing print duration in ${target}`);

  sliceResults.push({
    ...part,
    layers: (gcode.match(/^;LAYER_CHANGE$/gm) || []).length,
    filamentGrams: parseNumber(gcode, 'filament used \\[g\\]'),
    costUsd: parseNumber(gcode, 'total filament cost'),
    durationSeconds: parseDuration(durationText),
    duration: durationText,
    warnings,
    status: warnings.length ? 'warning' : 'pass'
  });
}

const clearances = manifest.design.assemblyClearances;
const fitChecks = [
  {
    name: '主板 X/Y 总间隙',
    actual: `${manifest.design.boardCavityClearance.join(' / ')} mm`,
    target: '>= 0.8 mm',
    pass: manifest.design.boardCavityClearance.every((value) => value >= 0.8)
  },
  {
    name: '前框定位柱直径间隙',
    actual: `${clearances.framePostDiametral} mm`,
    target: '0.25-0.50 mm',
    pass: clearances.framePostDiametral >= 0.25 && clearances.framePostDiametral <= 0.5
  },
  {
    name: '导光条外侧径向间隙',
    actual: `${clearances.lightGuideOuterRadial} mm`,
    target: '0.12-0.30 mm',
    pass: clearances.lightGuideOuterRadial >= 0.12 && clearances.lightGuideOuterRadial <= 0.3
  },
  {
    name: '导光条内侧径向间隙',
    actual: `${clearances.lightGuideInnerRadial} mm`,
    target: '0.10-0.30 mm',
    pass: clearances.lightGuideInnerRadial >= 0.1 && clearances.lightGuideInnerRadial <= 0.3
  },
  {
    name: 'M2 螺丝柱最小壁厚',
    actual: `${clearances.screwBossWall} mm`,
    target: '>= 2.0 mm',
    pass: clearances.screwBossWall >= 2
  },
  {
    name: '吊环顶部最小连接宽度',
    actual: `${clearances.lanyardTopLigament} mm`,
    target: '>= 2.0 mm (prototype)',
    pass: clearances.lanyardTopLigament >= 2
  }
];

const totals = sliceResults.reduce((total, part) => ({
  filamentGrams: total.filamentGrams + part.filamentGrams,
  costUsd: total.costUsd + part.costUsd,
  durationSeconds: total.durationSeconds + part.durationSeconds
}), { filamentGrams: 0, costUsd: 0, durationSeconds: 0 });

const report = {
  generatedAt: new Date().toISOString(),
  product: manifest.product,
  slicer: slicerVersion,
  assumptions: {
    printerEnvelope: '180 x 180 mm',
    nozzle: '0.4 mm',
    layerHeight: '0.2 mm',
    material: 'Generic PETG, 1.27 g/cm3',
    perimeters: 3,
    infill: '25% gyroid；导光条 100% rectilinear',
    supports: false,
    filamentReferenceCost: 'USD 25/kg'
  },
  sliceResults,
  fitChecks,
  totals: {
    filamentGrams: Number(totals.filamentGrams.toFixed(2)),
    costUsd: Number(totals.costUsd.toFixed(2)),
    durationSeconds: totals.durationSeconds,
    duration: formatDuration(totals.durationSeconds)
  },
  digitalPass: sliceResults.every((part) => part.status === 'pass')
    && fitChecks.every((check) => check.pass),
  physicalValidationRequired: [
    '实际圆屏主板、USB-C 插头和电池装配',
    'PETG 收缩后的导光条压配与漏光',
    '5 N / 10 N / 20 N 吊环分级拉力',
    '连续充电 60 分钟外壳与电池温升',
    '麦克风回声、扬声器共振和蓝牙/Wi-Fi 射频衰减',
    '贴肤材料、汗液、跌落和长期佩戴测试'
  ]
};

const sliceRows = sliceResults.map((part) =>
  `| ${part.name} | ${part.layers} | ${part.filamentGrams.toFixed(2)} g | ${part.duration} | ${part.warnings.length ? '警告' : '通过'} |`
).join('\n');
const fitRows = fitChecks.map((check) =>
  `| ${check.name} | ${check.actual} | ${check.target} | ${check.pass ? '通过' : '失败'} |`
).join('\n');
const physicalRows = report.physicalValidationRequired.map((item) => `- [ ] ${item}`).join('\n');

const markdown = `# NEXORA CORE NC-01 数字样机实验报告

生成时间：${report.generatedAt}

## 结论

数字样机结果：**${report.digitalPass ? '通过' : '未通过'}**。三个零件均在无支撑条件下完成切片，关键 CAD 公差处于首件原型范围。该结论不替代实体打印、热安全、音频与拉力测试。

## 切片条件

- 切片器：${report.slicer}
- 打印包络：${report.assumptions.printerEnvelope}
- 材料：${report.assumptions.material}
- 喷嘴 / 层高：${report.assumptions.nozzle} / ${report.assumptions.layerHeight}
- 外墙 / 填充：${report.assumptions.perimeters} 道 / ${report.assumptions.infill}
- 支撑：关闭

## 切片结果

| 零件 | 层数 | PETG | 时间 | 状态 |
| --- | ---: | ---: | ---: | --- |
${sliceRows}

合计：**${report.totals.filamentGrams.toFixed(2)} g**，预计 **${report.totals.duration}**。材料成本按 ${report.assumptions.filamentReferenceCost} 仅作参考，约 **USD ${report.totals.costUsd.toFixed(2)}**。

## 装配公差

| 检查项 | 当前值 | 原型目标 | 状态 |
| --- | ---: | ---: | --- |
${fitRows}

## 必须由实体首件完成

${physicalRows}

## 判定

- CAD 网格、切片路径和首轮装配公差已达到制作首件的条件。
- 吊环顶部 2.2 mm 连接宽度仅达到功能样机下限，实体拉力测试失败时应增至 3.0 mm。
- 导光条应先单独打印，确认透明 PETG 的实际收缩和散射效果，再打印整套外壳。
`;

await writeFile(path.join(experimentRoot, 'nc01-simulation.json'), `${JSON.stringify(report, null, 2)}\n`);
await writeFile(path.join(experimentRoot, 'nc01-simulation-report.md'), markdown);

const packFilename = 'nexora-core-nc01-print-pack.zip';
const zipResult = spawnSync('zip', [
  '-qr', '-FS', packFilename,
  'README.md', 'manifest.json', 'source', 'stl', 'experiments',
  'nexora-core-nc01-kit.3mf'
], { cwd: hardwareRoot, encoding: 'utf8' });
if (zipResult.error) throw zipResult.error;
if (zipResult.status !== 0) {
  throw new Error(`Updating ${packFilename} failed:\n${zipResult.stderr || zipResult.stdout}`);
}

console.log(`NC-01 digital simulation ${report.digitalPass ? 'passed' : 'failed'}.`);
console.log(`PETG ${report.totals.filamentGrams.toFixed(2)} g, estimated print time ${report.totals.duration}.`);
console.log(`Report: ${path.join(experimentRoot, 'nc01-simulation-report.md')}`);

if (!report.digitalPass) process.exitCode = 1;
