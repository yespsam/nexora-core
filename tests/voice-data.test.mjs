import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveVoice, voiceStatusBody } from '../netlify/functions/voice-data.mjs';

test('creature starter always overrides the old gender-based cast', () => {
  assert.equal(resolveVoice('female', '', 'cute').voice, 'zh-CN-YunxiaNeural');
  assert.equal(resolveVoice('female', '', 'cool').voice, 'zh-CN-YunjianNeural');
  assert.equal(resolveVoice('female', '', 'beautiful').voice, 'zh-CN-YunxiNeural');
});

test('creature archetype can be selected independently of profile gender', () => {
  assert.equal(resolveVoice('female', 'edge').name, '锋鸣');
  assert.equal(resolveVoice('male', 'sprout').name, '幼灵');
  assert.equal(resolveVoice('female', 'aether').name, '星语');
});

test('voice status advertises the creature cast by default', () => {
  const status = voiceStatusBody();
  assert.match(status.cast.voice, /^zh-CN-Yun/);
  assert.doesNotMatch(status.cast.voice, /Xiaoxiao|Xiaoyi/);
});
