import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [html, css, app, viewer, native, build] = await Promise.all([
  readFile(new URL('../desktop-pet/index.html', import.meta.url), 'utf8'),
  readFile(new URL('../desktop-pet/style.css', import.meta.url), 'utf8'),
  readFile(new URL('../desktop-pet/app.mjs', import.meta.url), 'utf8'),
  readFile(new URL('../shared/creature-3d-viewer.mjs', import.meta.url), 'utf8'),
  readFile(new URL('../macos/NexoraBridge/main.swift', import.meta.url), 'utf8'),
  readFile(new URL('../tools/build-nexora-bridge-macos.sh', import.meta.url), 'utf8')
]);

test('desktop pet surface contains only the native 3D companion', () => {
  assert.match(app, /Creature3DViewer/);
  assert.match(app, /interactiveRotation: false/);
  assert.match(viewer, /interactiveRotation === false/);
  assert.doesNotMatch(html, /<img\b/i);
  assert.doesNotMatch(css, /background-image/);
  assert.match(css, /background-color: rgba\(0, 0, 0, 0\) !important/);
  assert.doesNotMatch(html, /color-scheme/);
  assert.doesNotMatch(css, /color-scheme/);
});

test('desktop pet supports bounded click interactions and an on-demand compact conversation', () => {
  assert.match(app, /const clickActions = \['wave', 'nod', 'affection'\]/);
  assert.match(app, /stage\.addEventListener\('click'/);
  assert.match(app, /stage\.addEventListener\('dblclick'/);
  assert.match(app, /setConversationOpen\(!state\.conversationOpen\)/);
  assert.match(app, /type: 'chat-submit'/);
  assert.match(app, /receiveReply/);
  assert.match(html, /id="conversation-input"/);
  assert.match(html, /maxlength="160"/);
  assert.match(css, /\.conversation\[hidden\]/);
  assert.match(app, /window\.NexoraDesktopPet = Object\.freeze/);
});

test('macOS shell uses a transparent persistent panel with drag and click-through modes', () => {
  assert.match(native, /import WebKit/);
  assert.match(native, /DesktopPetPanel: NSPanel/);
  assert.match(native, /panel\.backgroundColor = \.clear/);
  assert.match(native, /panel\.isOpaque = false/);
  assert.match(native, /TransparentPetWebView/);
  assert.match(native, /setValue\(false, forKey: "drawsBackground"\)/);
  assert.match(native, /panel\.level = \.floating/);
  assert.match(native, /\.canJoinAllSpaces/);
  assert.match(native, /panel\.ignoresMouseEvents = enabled/);
  assert.match(native, /NSEvent\.addLocalMonitorForEvents/);
  assert.match(native, /\.scrollWheel/);
  assert.match(native, /\.magnify/);
  assert.match(native, /resizeWindow\(toWidth/);
  assert.match(native, /max\(220/);
  assert.match(native, /min\(560/);
  assert.match(native, /desktopPet\.frame\.v1/);
  assert.match(native, /inspectRuntime/);
  assert.match(native, /opaquePixels > 100/);
  assert.match(native, /CGWindowListCreateImage/);
  assert.match(native, /cornerAlpha/);
  assert.match(native, /resizeForSelfTest/);
  assert.match(native, /\/api\/device-bridge\/chat/);
  assert.match(native, /\/api\/device-bridge\/voice/);
  assert.match(native, /Authorization/);
  assert.match(native, /AVAudioPlayer/);
});

test('macOS package embeds the private 3D runtime for offline rendering', () => {
  assert.match(native, /nexora-pet:\/\/app\/desktop-pet\/index\.html/);
  assert.match(native, /WKURLSchemeHandler/);
  assert.match(build, /-framework WebKit/);
  assert.match(build, /-framework AVFoundation/);
  assert.match(build, /WEB_DIR=.*Contents\/Resources\/Web|WEB_DIR="\$RESOURCES_DIR\/Web"/);
  assert.match(build, /NEXORA_3D_CREATURES/);
  assert.match(build, /rigged\.glb/);
  assert.match(build, /--self-test-pet/);
});
