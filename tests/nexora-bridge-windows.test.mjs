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
  assert.match(source, /Credential Manager round trip failed/);
  assert.match(source, /Credential Manager self-test cleanup failed/);
  assert.match(source, /\.SelfTest\.\{Environment\.ProcessId\}/);
  assert.doesNotMatch(source, /Console\.(?:Write|WriteLine)\([^\n]*(?:secret|pairing)/i);
});

test('Windows bridge verifies pairing online before storing credentials', () => {
  assert.match(source, /\/api\/device-bridge\/status\?agentId=/);
  assert.match(source, /PairingVerifier\.VerifyAsync\(parsed\)/);
  assert.match(source, /HttpStatusCode\.Unauthorized/);
  assert.match(source, /HttpStatusCode\.NotFound/);
  assert.match(source, /配对完成。NEXORA Bridge 已在 Windows 右下角系统托盘保持在线。/);
  assert.ok(source.indexOf('PairingVerifier.VerifyAsync(parsed)') < source.indexOf('CredentialStore.Save(parsed)'));
});

test('Windows bridge secondary computers never require the product login page', () => {
  assert.match(source, /这台 Windows 电脑不需要登录 NEXORA CORE/);
  assert.match(source, /查看连接状态/);
  assert.match(source, /notifyIcon\.DoubleClick \+= \(_, _\) => ShowLocalStatus\(\)/);
  assert.doesNotMatch(source, /private void OpenProduct\(\)/);
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

test('Windows native self-test launches an allowlisted app and probes audio without changing state', () => {
  assert.match(source, /LaunchNotesForSelfTest/);
  assert.match(source, /process\.WaitForInputIdle\(3000\)/);
  assert.match(source, /ProbeWithoutChangingState/);
  assert.match(source, /SetMasterVolumeLevelScalar\(volume/);
  assert.match(source, /SetMute\(muted/);
  assert.match(build, /--self-test-native/);
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

test('Windows release build supports Authenticode signing and timestamp verification', () => {
  assert.match(build, /NEXORA_WINDOWS_CERT_THUMBPRINT/);
  assert.match(build, /signtool\.exe/);
  assert.match(build, /sign \/sha1/);
  assert.match(build, /\/fd SHA256/);
  assert.match(build, /\/tr \$TimestampUrl/);
  assert.match(build, /verify \/pa/);
});

test('Windows self-test initializes the real pairing window without displaying it', () => {
  assert.match(source, /using PairingForm pairingForm = new\(\)/);
  assert.match(source, /pairingForm\.AcceptButton/);
  assert.match(source, /Application\.SetHighDpiMode\(HighDpiMode\.PerMonitorV2\)/);
});
