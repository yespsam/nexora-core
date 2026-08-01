import assert from 'node:assert/strict';
import test from 'node:test';

import voiceSpeak, {
  createVoiceReadableStream,
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

test('voice stream forwards synthesis chunks without waiting for completion', async () => {
  let complete;
  async function* chunks() {
    yield Uint8Array.from([1, 2]);
    yield Uint8Array.from([3]);
  }
  const stream = createVoiceReadableStream('你好。', { voice: 'test' }, 'calm', {
    synthesizeVoice: chunks,
    onComplete(result) {
      complete = result;
    }
  });
  const reader = stream.getReader();
  assert.deepEqual([...((await reader.read()).value)], [1, 2]);
  assert.deepEqual([...((await reader.read()).value)], [3]);
  assert.equal((await reader.read()).done, true);
  assert.equal(complete.bytes, 3);
});

test('voice endpoint validates modern fetch requests before synthesis', async () => {
  const getResponse = await voiceSpeak(new Request('https://example.test/voice'));
  assert.equal(getResponse.status, 405);
  const emptyResponse = await voiceSpeak(new Request('https://example.test/voice', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: '' })
  }));
  assert.equal(emptyResponse.status, 400);
});
