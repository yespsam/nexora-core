import assert from 'node:assert/strict';
import test from 'node:test';

import {
  shouldBlockRecognizedSpeech,
  speechOverlapRatio,
  voiceControlState
} from '../shared/voice-turn.mjs';

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

test('short and fragmented assistant echoes are rejected', () => {
  const base = {
    lastAssistantText: '我在这里，今天也会认真陪着你。',
    lastAssistantAt: 1000,
    now: 5000
  };
  assert.equal(shouldBlockRecognizedSpeech({ ...base, text: '我在这里' }), true);
  assert.equal(shouldBlockRecognizedSpeech({ ...base, text: '今天会认真陪你' }), true);
  assert.ok(speechOverlapRatio('今天会认真陪你', base.lastAssistantText) >= 0.64);
});

test('old assistant speech no longer blocks recognition', () => {
  assert.equal(shouldBlockRecognizedSpeech({
    text: '今天也会陪着你',
    lastAssistantText: '我在这里，今天也会陪着你。',
    lastAssistantAt: 1000,
    now: 62000
  }), false);
});

test('voice control allows users to interrupt playback', () => {
  assert.deepEqual(voiceControlState({
    recognitionSupported: true,
    phase: 'speaking',
    hasVoiceOutput: true
  }), {
    disabled: false,
    label: '打断',
    ariaLabel: '打断回答并开始说话',
    pressed: false
  });
  assert.equal(voiceControlState({
    recognitionSupported: true,
    phase: 'thinking',
    busy: true
  }).disabled, true);
});
