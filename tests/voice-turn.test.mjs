import assert from 'node:assert/strict';
import test from 'node:test';

import {
  recognitionFailureMessage,
  recognitionCandidates,
  recognitionTranscript,
  parseVoiceControlCommand,
  resolveVoiceRecognition,
  shouldBlockRecognizedSpeech,
  speechOverlapRatio,
  VOICE_LISTEN_TIMEOUT_MS,
  VOICE_WAKE_SESSION_TIMEOUT_MS,
  VOICE_WAKE_COMMAND_WINDOW_MS,
  voiceRecognitionSessionTimeout,
  voiceWakeWords,
  voiceControlState
} from '../shared/voice-turn.mjs';

test('recognition combines final speech segments and bounds the message', () => {
  const results = [
    Object.assign([{ transcript: '今天中午' }], { isFinal: true }),
    Object.assign([{ transcript: '想吃火锅' }], { isFinal: true }),
    Object.assign([{ transcript: '还在识别' }], { isFinal: false })
  ];
  assert.equal(recognitionTranscript(results), '今天中午 想吃火锅');
  assert.equal(recognitionTranscript(null), '');
  assert.equal(recognitionTranscript([
    Object.assign([{ transcript: 'a'.repeat(220) }], { isFinal: true })
  ]).length, 160);
  assert.equal(VOICE_LISTEN_TIMEOUT_MS, 12000);
  assert.equal(VOICE_WAKE_SESSION_TIMEOUT_MS, 20000);
  assert.equal(VOICE_WAKE_COMMAND_WINDOW_MS, 8000);
  assert.equal(voiceRecognitionSessionTimeout('manual'), VOICE_LISTEN_TIMEOUT_MS);
  assert.equal(voiceRecognitionSessionTimeout('wake'), VOICE_WAKE_SESSION_TIMEOUT_MS);
});

test('recognition keeps alternate Safari transcripts with confidence', () => {
  const results = [Object.assign([
    { transcript: '你这个人物是巴萨阿尔法大兄弟', confidence: 0.52 },
    { transcript: '招手', confidence: 0.41 }
  ], { isFinal: true })];
  assert.deepEqual(recognitionCandidates(results), [
    { text: '你这个人物是巴萨阿尔法大兄弟', confidence: 0.52 },
    { text: '招手', confidence: 0.41 }
  ]);
});

test('valid actions outrank an incorrect first recognition alternative', () => {
  const results = [Object.assign([
    { transcript: '你这个人物是巴萨阿尔法大兄弟', confidence: 0.52 },
    { transcript: '招手', confidence: 0.41 }
  ], { isFinal: true })];
  const resolved = resolveVoiceRecognition(results, {
    wakeWords: voiceWakeWords('星澜', 'cute'),
    wakeActive: true
  });
  assert.equal(resolved.text, '招手');
  assert.equal(resolved.command.type, 'action');
  assert.equal(resolved.command.action, 'wave');
});

test('wake mode ignores alternatives without a wake word', () => {
  const results = [Object.assign([
    { transcript: '今天想吃火锅', confidence: 0.76 },
    { transcript: '今天想吃苹果', confidence: 0.24 }
  ], { isFinal: true })];
  const resolved = resolveVoiceRecognition(results, {
    wakeWords: voiceWakeWords('星澜', 'cute')
  });
  assert.equal(resolved.text, '今天想吃火锅');
  assert.equal(resolved.command, null);
});

test('wake commands can be recovered from a lower recognition alternative', () => {
  const results = [Object.assign([
    { transcript: '来找我招手', confidence: 0.61 },
    { transcript: '奈索拉招手', confidence: 0.39 }
  ], { isFinal: true })];
  const resolved = resolveVoiceRecognition(results, {
    wakeWords: voiceWakeWords('星澜', 'cute')
  });
  assert.equal(resolved.text, '奈索拉招手');
  assert.equal(resolved.command.type, 'action');
  assert.equal(resolved.command.action, 'wave');
});

test('wake words resolve custom names and route names', () => {
  assert.deepEqual(voiceWakeWords('星澜', 'cute').slice(0, 2), ['星澜', '露莫']);
  assert.ok(voiceWakeWords('', 'cool').includes('维尔'));
  assert.ok(voiceWakeWords('', 'beautiful').includes('艾拉'));
  assert.ok(voiceWakeWords('', 'cute').includes('耐索拉'));
});

test('voice commands require a wake word unless a manual command window is active', () => {
  const wakeWords = voiceWakeWords('星澜', 'cute');
  assert.equal(parseVoiceControlCommand('随便招招手', { wakeWords }), null);
  assert.deepEqual(parseVoiceControlCommand('星澜，招招手', { wakeWords }), {
    type: 'action',
    action: 'wave',
    wakeWord: '星澜',
    remainder: '招招手'
  });
  assert.equal(parseVoiceControlCommand('跑起来', { wakeWords, wakeActive: true }).action, 'run');
  assert.equal(parseVoiceControlCommand('停下', { wakeWords, wakeActive: true }).action, 'idle');
  assert.equal(parseVoiceControlCommand('张手', { wakeWords, wakeActive: true }).action, 'wave');
  assert.equal(parseVoiceControlCommand('招收', { wakeWords, wakeActive: true }).action, 'wave');
});

test('wake-only and wake-plus-message phrases stay distinct', () => {
  const wakeWords = voiceWakeWords('露莫', 'cute');
  assert.equal(parseVoiceControlCommand('露莫', { wakeWords }).type, 'wake');
  assert.deepEqual(parseVoiceControlCommand('露莫，今天过得怎么样', { wakeWords }), {
    type: 'message',
    wakeWord: '露莫',
    remainder: '今天过得怎么样'
  });
});

test('recognition failures give recoverable user-facing guidance', () => {
  assert.match(recognitionFailureMessage('not-allowed'), /麦克风权限/);
  assert.match(recognitionFailureMessage('audio-capture'), /麦克风/);
  assert.match(recognitionFailureMessage('no-speech'), /没有听清/);
  assert.match(recognitionFailureMessage('network'), /网络/);
  assert.equal(recognitionFailureMessage('aborted'), '');
});

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
