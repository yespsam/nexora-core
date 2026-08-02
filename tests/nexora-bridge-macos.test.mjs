import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [source, plist, build] = await Promise.all([
  readFile(new URL('../macos/NexoraBridge/main.swift', import.meta.url), 'utf8'),
  readFile(new URL('../macos/NexoraBridge/Info.plist', import.meta.url), 'utf8'),
  readFile(new URL('../tools/build-nexora-bridge-macos.sh', import.meta.url), 'utf8')
]);

test('native macOS bridge keeps credentials in the device-only Keychain', () => {
  assert.match(source, /kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly/);
  assert.match(source, /SecItemCopyMatching/);
  assert.match(source, /SecItemUpdate/);
  assert.doesNotMatch(source, /print\([^\n]*(?:secret|pairing)/i);
  assert.match(source, /CommandLine\.arguments\.contains\("--pair"\)/);
});

test('native macOS bridge implements the same encrypted command boundary', () => {
  assert.match(source, /HKDF<SHA256>/);
  assert.match(source, /AES\.GCM\.open/);
  assert.match(source, /nexora-device-command-v1/);
  assert.match(source, /NXC1/);
});

test('native execution uses fixed binaries and never invokes a shell', () => {
  assert.match(source, /\/usr\/bin\/open/);
  assert.match(source, /\/usr\/bin\/osascript/);
  assert.match(source, /"calculator"/);
  assert.doesNotMatch(source, /\/bin\/(?:sh|bash|zsh)/);
});

test('macOS bundle is a menu bar app and packages distributable artifacts', () => {
  assert.match(plist, /<key>LSUIElement<\/key>\s*<true\/>/);
  assert.match(plist, /com\.nexora\.core\.bridge/);
  assert.match(build, /arm64 x86_64/);
  assert.match(build, /NEXORA-Bridge-macOS\.zip/);
  assert.match(build, /NEXORA-Bridge-macOS\.dmg/);
});

test('macOS bridge exposes the desktop pet from its menu without a second app', () => {
  assert.match(source, /DesktopPetController/);
  assert.match(source, /显示桌面宠物/);
  assert.match(source, /桌面伙伴/);
  assert.match(source, /进化形态/);
  assert.match(source, /互动动作/);
  assert.match(source, /鼠标穿透/);
  assert.match(source, /恢复默认大小/);
  assert.match(source, /和桌面伙伴对话/);
  assert.match(source, /设置伙伴名字/);
  assert.match(source, /desktopPet\.chatHistory\.v1/);
  assert.match(source, /creature:\\\(starter\)/);
  assert.match(source, /--self-test-cloud-pet/);
  assert.match(source, /desktop pet cloud self-test passed/);
});
