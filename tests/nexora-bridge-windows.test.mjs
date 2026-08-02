import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [source, project, build, workflow] = await Promise.all([
  readFile(new URL('../windows/NexoraBridge/Program.cs', import.meta.url), 'utf8'),
  readFile(new URL('../windows/NexoraBridge/NexoraBridge.csproj', import.meta.url), 'utf8'),
  readFile(new URL('../tools/build-nexora-bridge-windows.ps1', import.meta.url), 'utf8'),
  readFile(new URL('../.github/workflows/build-windows-bridge.yml', import.meta.url), 'utf8')
]);

test('Windows bridge stores credentials in Windows Credential Manager', () => {
  assert.match(source, /CredWriteW/);
  assert.match(source, /CredReadW/);
  assert.match(source, /CredDeleteW/);
  assert.match(source, /CredPersistLocalMachine/);
  assert.doesNotMatch(source, /Console\.(?:Write|WriteLine)\([^\n]*(?:secret|pairing)/i);
});

test('Windows bridge implements the shared encrypted command boundary', () => {
  assert.match(source, /HKDF\.DeriveKey/);
  assert.match(source, /AesGcm/);
  assert.match(source, /nexora-device-command-v1/);
  assert.match(source, /NXC1/);
  assert.match(source, /oEHSKK31e_6lDMZbBS09AwjAZuWHb03b/);
  assert.match(source, /command\.IsAllowed/);
});

test('Windows actions use native fixed APIs without a command shell', () => {
  assert.match(source, /IAudioEndpointVolume/);
  assert.match(source, /keybd_event/);
  assert.match(source, /calc\.exe/);
  assert.match(source, /notepad\.exe/);
  assert.doesNotMatch(source, /(?:cmd|powershell|pwsh)\.exe/i);
  assert.doesNotMatch(source, /ProcessStartInfo[^}]*Arguments/s);
});

test('Windows app packages self-contained x64 and ARM64 executables', () => {
  assert.match(project, /<UseWindowsForms>true<\/UseWindowsForms>/);
  assert.match(project, /<PublishSingleFile>true<\/PublishSingleFile>/);
  assert.match(build, /NEXORA-Bridge-Windows-\$ArchiveArchitecture\.zip/);
  assert.match(build, /WriteAllText\(\$Checksum/);
  assert.match(workflow, /win-x64/);
  assert.match(workflow, /win-arm64/);
  assert.match(workflow, /windows-latest/);
});
