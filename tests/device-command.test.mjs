import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeDeviceCommand, parseDeviceCommand } from '../shared/device-command.mjs';

test('computer commands stay inside the explicit safe capability list', () => {
  assert.deepEqual(parseDeviceCommand('把电脑音量调到 35'), {
    version: 1,
    target: 'computer',
    action: 'volume.set',
    parameters: { level: 35 },
    label: '电脑音量已设为 35%'
  });
  assert.equal(parseDeviceCommand('删除下载目录'), null);
  assert.equal(parseDeviceCommand('打开终端'), null);
  assert.equal(normalizeDeviceCommand({
    version: 1,
    target: 'computer',
    action: 'app.open',
    parameters: { app: 'terminal' }
  }), null);
});

test('media and home phrases produce bounded structured commands', () => {
  assert.equal(parseDeviceCommand('暂停音乐')?.action, 'media.pause');
  assert.deepEqual(parseDeviceCommand('打开客厅灯'), {
    version: 1,
    target: 'home',
    action: 'light.on',
    parameters: { room: '客厅' },
    label: '客厅灯光已打开'
  });
  assert.equal(parseDeviceCommand('把空调温度调到 99 度')?.parameters.degrees, 30);
});

test('desktop app commands accept concise English voice transcripts', () => {
  assert.deepEqual(parseDeviceCommand('open calendar'), {
    version: 1,
    target: 'computer',
    action: 'app.open',
    parameters: { app: 'calendar' },
    label: '正在打开日历'
  });
  assert.equal(parseDeviceCommand('please open notes')?.parameters.app, 'notes');
  assert.equal(parseDeviceCommand('open terminal'), null);
});
