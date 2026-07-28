import assert from 'node:assert/strict';
import test from 'node:test';

import { shouldBlockRecognizedSpeech } from '../shared/voice-turn.mjs';

test('speech output guard rejects late recognition events', () => {
  assert.equal(shouldBlockRecognizedSpeech({
    text: '今天天气不错',
    echoGuardUntil: 2000,
    now: 1500
  }), true);
});

test('recent assistant speech is rejected but new user speech is accepted', () => {
  const base = {
    lastAssistantText: '我在这里，今天也会陪着你。',
    lastAssistantAt: 1000,
    now: 2500
  };
  assert.equal(shouldBlockRecognizedSpeech({ ...base, text: '今天也会陪着你' }), true);
  assert.equal(shouldBlockRecognizedSpeech({ ...base, text: '我想聊聊明天的计划' }), false);
});

test('old assistant speech no longer blocks recognition', () => {
  assert.equal(shouldBlockRecognizedSpeech({
    text: '今天也会陪着你',
    lastAssistantText: '我在这里，今天也会陪着你。',
    lastAssistantAt: 1000,
    now: 62000
  }), false);
});
