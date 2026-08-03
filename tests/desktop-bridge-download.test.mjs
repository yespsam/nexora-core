import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  DESKTOP_BRIDGE_DOWNLOADS,
  DESKTOP_BRIDGE_RELEASE_TAG,
  desktopBridgeDownloadView,
  detectDesktopBridgePlatform
} from '../shared/desktop-bridge-download.mjs';

test('desktop bridge downloads stay pinned to the private internal release', () => {
  assert.equal(DESKTOP_BRIDGE_RELEASE_TAG, 'bridge-v0.3.0-internal');
  assert.deepEqual(Object.keys(DESKTOP_BRIDGE_DOWNLOADS), ['macos', 'windows-x64', 'windows-arm64']);
  for (const download of Object.values(DESKTOP_BRIDGE_DOWNLOADS)) {
    assert.match(download.href, /^https:\/\/github\.com\/yespsam\/nexora-core\/releases\/download\/bridge-v0\.3\.0-internal\//);
    assert.match(download.file, /\.(?:dmg|zip)$/);
  }
});

test('desktop platform detection selects macOS and ordinary Windows computers', async () => {
  assert.equal(await detectDesktopBridgePlatform({ platform: 'MacIntel', userAgent: 'Macintosh', maxTouchPoints: 0 }), 'macos');
  assert.equal(await detectDesktopBridgePlatform({ platform: 'Win32', userAgent: 'Windows NT 10.0; Win64; x64' }), 'windows-x64');
});

test('desktop platform detection distinguishes Windows ARM64', async () => {
  const navigatorValue = {
    platform: 'Win32',
    userAgent: 'Windows NT 10.0',
    userAgentData: {
      platform: 'Windows',
      mobile: false,
      async getHighEntropyValues() {
        return { architecture: 'arm', bitness: '64' };
      }
    }
  };
  assert.equal(await detectDesktopBridgePlatform(navigatorValue), 'windows-arm64');
});

test('mobile devices keep pairing available without selecting a desktop binary', async () => {
  assert.equal(await detectDesktopBridgePlatform({ platform: 'iPhone', userAgent: 'iPhone', maxTouchPoints: 5 }), 'mobile');
  const view = desktopBridgeDownloadView('mobile');
  assert.equal(view.action, '查看版本');
  assert.match(view.note, /电脑负责运行客户端/);
});

test('device panel exposes platform downloads without embedding binaries in the public build', async () => {
  const [html, app, build] = await Promise.all([
    readFile(new URL('../soulmate/index.html', import.meta.url), 'utf8'),
    readFile(new URL('../soulmate/app.js', import.meta.url), 'utf8'),
    readFile(new URL('../tools/build-public-site.mjs', import.meta.url), 'utf8')
  ]);
  assert.match(html, /id="bridge-download-primary"/);
  assert.match(html, /data-bridge-download="windows-arm64"/);
  assert.match(html, /id="bridge-agent-list"/);
  assert.match(html, /id="bridge-add-button"[^>]*hidden/);
  assert.match(html, /id="bridge-revoke-button"[^>]*hidden/);
  assert.match(html, /rel="noopener noreferrer"/);
  assert.match(app, /detectDesktopBridgePlatform/);
  assert.match(app, /revokeSoulmateCommandAgentById/);
  assert.match(app, /selectSoulmateCommandAgent/);
  assert.match(app, /listSoulmateCommandAgentStatuses/);
  assert.match(app, /bridgeRevokeButton\.addEventListener\('click', revokeCommandAgent\)/);
  assert.match(build, /shared\/desktop-bridge-download\.mjs/);
  assert.doesNotMatch(build, /NEXORA-Bridge-Windows-x64\.zip/);
});
