import test from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveCreatureStarter,
  resolveVoice,
  voiceStatusBody
} from '../netlify/functions/voice-data.mjs';
import { handler as voiceStatusHandler } from '../netlify/functions/voice-status.mjs';
import { handler as voiceVoicesHandler } from '../netlify/functions/voice-voices.mjs';

test('creature starter always overrides the old gender-based cast', () => {
  assert.equal(resolveVoice('female', '', 'cute').voice, 'zh-CN-YunxiaNeural');
  assert.equal(resolveVoice('female', '', 'cool').voice, 'zh-CN-YunjianNeural');
  assert.equal(resolveVoice('female', '', 'beautiful').voice, 'zh-CN-YunxiNeural');
  assert.equal(resolveVoice('cute', '').name, '幼灵');
  assert.equal(resolveVoice('creature:cool', '').name, '锋鸣');
  assert.equal(resolveCreatureStarter('creature:beautiful'), 'beautiful');
});

test('creature archetype can be selected independently of profile gender', () => {
  assert.equal(resolveVoice('female', 'edge').name, '锋鸣');
  assert.equal(resolveVoice('male', 'sprout').name, '幼灵');
  assert.equal(resolveVoice('female', 'aether').name, '星语');
});

test('voice status advertises the creature cast by default', () => {
  const status = voiceStatusBody();
  assert.equal(status.active_archetype, 'sprout');
  assert.equal(status.cast.name, '幼灵');
  assert.doesNotMatch(status.cast.voice, /Xiaoxiao|Xiaoyi/);
});

test('voice API diagnostics never map creature routes to the legacy human cast', async () => {
  const listResponse = await voiceVoicesHandler({ rawQuery: 'persona=cute' });
  const list = JSON.parse(listResponse.body);
  assert.equal(list.persona.id, 'creature_cute');
  assert.equal(list.persona.display_name, 'LUMO / 露莫');
  assert.equal(list.active_archetype, 'sprout');
  assert.deepEqual(list.resources.map((item) => item.archetype), ['sprout', 'edge', 'aether']);
  assert.doesNotMatch(JSON.stringify(list), /小栖|萝莉音|御姐音/);

  const statusResponse = await voiceStatusHandler({ rawQuery: 'persona=creature%3Acool' });
  const status = JSON.parse(statusResponse.body);
  assert.equal(status.active_archetype, 'edge');
  assert.equal(status.cast.name, '锋鸣');
});
