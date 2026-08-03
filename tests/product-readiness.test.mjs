import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  evaluateProductReadiness,
  validateEvtAcceptance,
  validateEvtBom
} from '../shared/product-readiness.mjs';

const evtRoot = new URL('../hardware/soulmate-pendant/evt/', import.meta.url);

test('repository EVT BOM and acceptance plan are machine-valid', async () => {
  const [bom, acceptance] = await Promise.all([
    readFile(new URL('nc01-bom-v1.json', evtRoot), 'utf8').then(JSON.parse),
    readFile(new URL('nc01-acceptance-v1.json', evtRoot), 'utf8').then(JSON.parse)
  ]);
  assert.equal(validateEvtBom(bom).model, 'NC-01');
  assert.equal(validateEvtAcceptance(acceptance).stage, 'EVT-0');
  const report = evaluateProductReadiness(bom, acceptance);
  assert.equal(report.ready, false);
  assert.equal(report.bom.total, 12);
  assert.equal(report.bom.selected, 3);
  assert.equal(report.acceptance.total, 16);
  assert.equal(report.acceptance.passed, 3);
  assert.ok(report.blockers.some((item) => item.id === 'assembly-fit'));
});

test('passed acceptance checks cannot omit evidence', () => {
  assert.throws(() => validateEvtAcceptance({ checks: [{
    id: 'unsafe-pass',
    name: 'No evidence',
    category: 'physical',
    target: 'Must be measured',
    status: 'passed'
  }] }), /requires evidence/);
});

test('blocked acceptance checks must name the real blocker', () => {
  assert.throws(() => validateEvtAcceptance({ checks: [{
    id: 'unknown-blocker',
    name: 'Unknown',
    category: 'physical',
    target: 'Must be measured',
    status: 'blocked'
  }] }), /requires a blocker/);
});
