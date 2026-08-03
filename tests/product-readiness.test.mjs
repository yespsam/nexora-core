import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  evaluateProductReadiness,
  evaluateServiceBayFit,
  validateEvtAcceptance,
  validateEvtBom,
  validateEvtPinPlan
} from '../shared/product-readiness.mjs';

const evtRoot = new URL('../hardware/soulmate-pendant/evt/', import.meta.url);

test('repository EVT BOM and acceptance plan are machine-valid', async () => {
  const [bom, acceptance, pinPlan, manifest] = await Promise.all([
    readFile(new URL('nc01-bom-v1.json', evtRoot), 'utf8').then(JSON.parse),
    readFile(new URL('nc01-acceptance-v1.json', evtRoot), 'utf8').then(JSON.parse),
    readFile(new URL('nc01-pin-plan-v1.json', evtRoot), 'utf8').then(JSON.parse),
    readFile(new URL('../manifest.json', evtRoot), 'utf8').then(JSON.parse)
  ]);
  assert.equal(validateEvtBom(bom).model, 'NC-01');
  assert.equal(validateEvtAcceptance(acceptance).stage, 'EVT-0');
  assert.equal(validateEvtPinPlan(pinPlan).assignments.length, 9);
  const report = evaluateProductReadiness(bom, acceptance, {
    pinPlan,
    serviceBayMm: manifest.design.serviceBay
  });
  assert.equal(report.ready, false);
  assert.equal(report.bom.total, 12);
  assert.equal(report.bom.selected, 3);
  assert.equal(report.bom.quoted, 6);
  assert.equal(report.bom.quotedSubtotalUsd, 100.17);
  assert.equal(report.acceptance.total, 16);
  assert.equal(report.acceptance.passed, 3);
  assert.equal(report.hardware.pinPlan.conflicts, 0);
  assert.equal(report.hardware.serviceBay.overCapacity, true);
  assert.ok(report.hardware.serviceBay.minimumFillRatio > 1);
  assert.deepEqual(report.hardware.serviceBay.missingDimensions, ['mic-mute', 'status-light']);
  assert.ok(report.blockers.some((item) => item.id === 'assembly-fit'));
});

test('service bay capacity check proves the breakout stack cannot fit', async () => {
  const bom = JSON.parse(await readFile(new URL('nc01-bom-v1.json', evtRoot), 'utf8'));
  const fit = evaluateServiceBayFit(bom, [31.5, 28, 5.8]);
  assert.equal(fit.serviceBayVolumeMm3, 5115.6);
  assert.ok(fit.minimumComponentVolumeMm3 > fit.serviceBayVolumeMm3);
});

test('pin plan rejects reserved and strapping conflicts', () => {
  const base = {
    reserved: [{ gpio: 8, function: 'lcd' }],
    avoid: [{ gpio: 45, reason: 'strapping' }]
  };
  assert.throws(() => validateEvtPinPlan({ ...base, assignments: [
    { gpio: 8, signal: 'audio', direction: 'output' }
  ] }), /conflicts on GPIO8/);
  assert.throws(() => validateEvtPinPlan({ ...base, assignments: [
    { gpio: 45, signal: 'audio', direction: 'output' }
  ] }), /conflicts on GPIO45/);
});

test('EVT-A pin plan stays aligned with the firmware configuration', async () => {
  const [pinPlan, config] = await Promise.all([
    readFile(new URL('nc01-pin-plan-v1.json', evtRoot), 'utf8').then(JSON.parse),
    readFile(new URL('../firmware/include/nc01_config.h', evtRoot), 'utf8')
  ]);
  const constants = {
    'audio-bclk': 'kAudioBitClockPin',
    'audio-lrclk': 'kAudioWordSelectPin',
    'microphone-data': 'kMicrophoneDataPin',
    'speaker-data': 'kSpeakerDataPin',
    'amplifier-shutdown': 'kAmplifierShutdownPin',
    'status-light-data': 'kStatusLightDataPin',
    'mic-mute-sense': 'kMicMuteSensePin',
    'haptic-a': 'kHapticDrivePinA',
    'haptic-b': 'kHapticDrivePinB'
  };
  for (const assignment of pinPlan.assignments) {
    assert.match(config, new RegExp(`constexpr uint8_t ${constants[assignment.signal]} = ${assignment.gpio};`));
  }
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
