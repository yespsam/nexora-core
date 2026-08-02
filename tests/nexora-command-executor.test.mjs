import assert from 'node:assert/strict';
import test from 'node:test';

import { parseDeviceCommand } from '../shared/device-command.mjs';
import { executeNexoraCommand } from '../tools/nexora-command-executor.mjs';

test('native macOS execution uses fixed binaries and argument arrays', async () => {
  const calls = [];
  const execFileImpl = async (...args) => { calls.push(args); };
  const result = await executeNexoraCommand(parseDeviceCommand('把电脑音量调到35'), {
    mode: 'native',
    platform: 'darwin',
    execFileImpl
  });
  assert.equal(result.status, 'executed');
  assert.equal(calls[0][0], '/usr/bin/osascript');
  assert.deepEqual(calls[0][1], ['-e', 'set volume output volume 35']);
  assert.equal(typeof calls[0][1], 'object');
});

test('native execution keeps home commands simulated and rejects unknown actions', async () => {
  let executions = 0;
  const home = await executeNexoraCommand(parseDeviceCommand('打开客厅灯'), {
    mode: 'native',
    platform: 'darwin',
    execFileImpl: async () => { executions += 1; }
  });
  assert.equal(home.status, 'simulated');
  assert.equal(executions, 0);
  assert.equal((await executeNexoraCommand({ action: 'shell.exec' })).status, 'rejected');
});

test('application opening is limited to the parser allowlist', async () => {
  const calls = [];
  const result = await executeNexoraCommand(parseDeviceCommand('打开计算器'), {
    mode: 'native',
    platform: 'darwin',
    execFileImpl: async (...args) => { calls.push(args); }
  });
  assert.equal(result.ok, true);
  assert.deepEqual(calls[0][0], '/usr/bin/open');
  assert.deepEqual(calls[0][1], ['-a', 'Calculator']);
});
