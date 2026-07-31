import assert from 'node:assert/strict';
import test from 'node:test';

import {
  prepareSpeechText,
  voiceProsody
} from '../netlify/functions/voice-speak.mjs';

test('voice prosody keeps mood changes subtle and route-specific', () => {
  const cast = { rate: '-2%', pitch: '+0Hz' };
  assert.deepEqual(voiceProsody(cast, 'happy'), {
    rate: '-1%',
    pitch: '+0Hz',
    volume: '96%'
  });
  assert.deepEqual(voiceProsody(cast, 'calm'), {
    rate: '-3%',
    pitch: '+0Hz',
    volume: '96%'
  });
});

test('speech text is converted into clean conversational punctuation', () => {
  assert.equal(
    prepareSpeechText('**今天的计划：** 先散步……然后休息'),
    '今天的计划，先散步。然后休息。'
  );
  assert.equal(prepareSpeechText('看看 https://example.com'), '看看 一个链接。');
  assert.equal(prepareSpeechText('  '), '');
});
