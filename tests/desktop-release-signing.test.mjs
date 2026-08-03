import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const workflow = await readFile(
  new URL('../.github/workflows/release-desktop-bridges.yml', import.meta.url),
  'utf8'
);
const internalWindowsWorkflow = await readFile(
  new URL('../.github/workflows/build-windows-bridge.yml', import.meta.url),
  'utf8'
);

test('signed desktop releases run only through an explicit private workflow', () => {
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /permissions:\s+contents: read/);
  assert.doesNotMatch(workflow, /pull_request:/);
  assert.doesNotMatch(workflow, /contents: write/);
});

test('macOS release secrets enter a temporary keychain and are removed afterwards', () => {
  assert.match(workflow, /APPLE_DEVELOPER_ID_P12_BASE64/);
  assert.match(workflow, /APPLE_NOTARY_KEY_P8_BASE64/);
  assert.match(workflow, /security create-keychain/);
  assert.match(workflow, /NEXORA_CODESIGN_KEYCHAIN/);
  assert.match(workflow, /notarytool store-credentials/);
  assert.match(workflow, /npm run release:bridge:macos/);
  assert.match(workflow, /security delete-keychain/);
});

test('Windows release imports a PFX, signs both architectures, and removes the certificate', () => {
  assert.match(workflow, /WINDOWS_SIGNING_PFX_BASE64/);
  assert.match(workflow, /Import-PfxCertificate/);
  assert.match(workflow, /-Runtime win-x64/);
  assert.match(workflow, /-Runtime win-arm64/);
  assert.match(workflow, /Remove-Item "Cert:\\CurrentUser\\My/);
});

test('desktop workflows use the current Node 24 GitHub Actions runtimes', () => {
  assert.doesNotMatch(workflow, /actions\/(?:checkout|setup-node|setup-dotnet|upload-artifact)@v4/);
  assert.doesNotMatch(internalWindowsWorkflow, /actions\/(?:checkout|setup-dotnet|upload-artifact)@v4/);
  assert.match(workflow, /actions\/checkout@v7/);
  assert.match(internalWindowsWorkflow, /actions\/setup-dotnet@v6/);
});
