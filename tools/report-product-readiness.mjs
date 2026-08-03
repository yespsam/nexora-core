import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { evaluateProductReadiness } from '../shared/product-readiness.mjs';

const toolFile = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(toolFile), '..');
const evtRoot = path.join(root, 'hardware/soulmate-pendant/evt');
const [bom, acceptance, pinPlan, pendantManifest] = await Promise.all([
  readFile(path.join(evtRoot, 'nc01-bom-v1.json'), 'utf8').then(JSON.parse),
  readFile(path.join(evtRoot, 'nc01-acceptance-v1.json'), 'utf8').then(JSON.parse),
  readFile(path.join(evtRoot, 'nc01-pin-plan-v1.json'), 'utf8').then(JSON.parse),
  readFile(path.join(root, 'hardware/soulmate-pendant/manifest.json'), 'utf8').then(JSON.parse)
]);
const report = evaluateProductReadiness(bom, acceptance, {
  pinPlan,
  serviceBayMm: pendantManifest.design.serviceBay
});

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`${report.model} ${report.stage} 产品就绪报告`);
  console.log(`BOM 已冻结 ${report.bom.selected}/${report.bom.total}，已到手 ${report.bom.procured}/${report.bom.total}`);
  console.log(`EVT-A 已报价 ${report.bom.quoted}/${report.bom.total} 类，三台参考小计 USD ${report.bom.quotedSubtotalUsd.toFixed(2)}（不含运输、税费和未选器件）`);
  console.log(`引脚计划 ${report.hardware.pinPlan.assignments} 路，冲突 ${report.hardware.pinPlan.conflicts}`);
  const serviceBay = report.hardware.serviceBay;
  console.log(`服务仓最低体积占用 ${(serviceBay.minimumFillRatio * 100).toFixed(1)}%，${serviceBay.overCapacity ? '开发板器件不能整体装入，必须进入 EVT-B 集成设计' : '仍需进行真实三维装配'}`);
  if (serviceBay.missingDimensions.length) console.log(`- 尚缺尺寸：${serviceBay.missingDimensions.join(', ')}`);
  console.log(`必需验收 ${report.acceptance.passed}/${report.acceptance.total} 通过`);
  for (const category of report.acceptance.categories) {
    console.log(`- ${category.category}: ${category.passed}/${category.total}`);
  }
  console.log(`当前结论：${report.ready ? '可以进入下一阶段' : `阻断，仍有 ${report.blockers.length} 项未通过`}`);
  for (const blocker of report.blockers.slice(0, 8)) console.log(`- ${blocker.name}：${blocker.blocker}`);
}

if (process.argv.includes('--require-ready') && !report.ready) process.exitCode = 2;
