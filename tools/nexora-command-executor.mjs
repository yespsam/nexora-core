import { execFile as nodeExecFile } from 'node:child_process';
import { promisify } from 'node:util';

import { normalizeDeviceCommand } from '../shared/device-command.mjs';

const executeFile = promisify(nodeExecFile);
const applicationNames = Object.freeze({
  safari: 'Safari',
  music: 'Music',
  calendar: 'Calendar',
  notes: 'Notes',
  calculator: 'Calculator'
});

function volumeChangeScript(delta) {
  return [
    'set currentVolume to output volume of (get volume settings)',
    `set nextVolume to currentVolume + ${delta}`,
    'if nextVolume > 100 then set nextVolume to 100',
    'if nextVolume < 0 then set nextVolume to 0',
    'set volume output volume nextVolume'
  ].join('\n');
}

function nativeInvocation(command) {
  if (command.action === 'volume.set') {
    return ['/usr/bin/osascript', ['-e', `set volume output volume ${command.parameters.level}`]];
  }
  if (command.action === 'volume.change') {
    return ['/usr/bin/osascript', ['-e', volumeChangeScript(command.parameters.delta)]];
  }
  if (command.action === 'volume.mute') {
    return ['/usr/bin/osascript', ['-e', 'set volume with output muted']];
  }
  if (command.action === 'volume.unmute') {
    return ['/usr/bin/osascript', ['-e', 'set volume without output muted']];
  }
  const mediaScripts = {
    'media.play': 'tell application "Music" to play',
    'media.pause': 'tell application "Music" to pause',
    'media.next': 'tell application "Music" to next track',
    'media.previous': 'tell application "Music" to previous track'
  };
  if (mediaScripts[command.action]) {
    return ['/usr/bin/osascript', ['-e', mediaScripts[command.action]]];
  }
  if (command.action === 'app.open' && applicationNames[command.parameters.app]) {
    return ['/usr/bin/open', ['-a', applicationNames[command.parameters.app]]];
  }
  return null;
}

export async function executeNexoraCommand(commandValue, options = {}) {
  const command = normalizeDeviceCommand(commandValue);
  if (!command) return { ok: false, status: 'rejected', summary: '指令不在安全白名单内' };
  const mode = options.mode === 'native' ? 'native' : 'simulation';
  if (mode !== 'native' || command.target === 'home') {
    return { ok: true, status: 'simulated', summary: command.label, command };
  }
  if ((options.platform || process.platform) !== 'darwin') {
    return { ok: false, status: 'unsupported', summary: '当前系统不支持本机执行', command };
  }
  const invocation = nativeInvocation(command);
  if (!invocation) return { ok: false, status: 'rejected', summary: '指令不在本机白名单内', command };
  try {
    const execFileImpl = options.execFileImpl || executeFile;
    await execFileImpl(invocation[0], invocation[1], {
      timeout: 5000,
      windowsHide: true,
      maxBuffer: 16384
    });
    return { ok: true, status: 'executed', summary: command.label, command };
  } catch (error) {
    return { ok: false, status: 'failed', summary: '本机没有完成这条指令', command };
  }
}
