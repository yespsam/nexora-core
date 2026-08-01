import test from 'node:test';
import assert from 'node:assert/strict';

import {
  appendChatStreamDelta,
  firstSpeechSegment,
  remainingSpeechText,
  parseChatStreamEvent
} from '../shared/chat-stream.mjs';

test('chat stream parser accepts named SSE events and multiline data', () => {
  assert.deepEqual(parseChatStreamEvent('event: delta\ndata: {"text":"你好"}'), {
    event: 'delta',
    data: { text: '你好' }
  });
  assert.deepEqual(parseChatStreamEvent('data: {"mode":\ndata: "cloud_llm"}'), {
    event: 'message',
    data: { mode: 'cloud_llm' }
  });
  assert.equal(parseChatStreamEvent('event: delta\ndata: {bad json}'), null);
  assert.equal(parseChatStreamEvent('event: delta'), null);
});

test('chat stream deltas remain compact and never exceed the message boundary', () => {
  assert.equal(appendChatStreamDelta('你好', '   今天\n见'), '你好 今天 见');
  assert.equal(appendChatStreamDelta('1234', '5678', 6), '123456');
  assert.equal(appendChatStreamDelta('', null), '');
});

test('early speech waits for a meaningful sentence or clause boundary', () => {
  assert.equal(firstSpeechSegment('下午累坏了吧，是开会多'), '下午累坏了吧，');
  assert.equal(firstSpeechSegment('辛苦啦，后面还有一句', 3), '辛苦啦，');
  assert.equal(firstSpeechSegment('好，继续说'), '');
  assert.equal(firstSpeechSegment('今天想早点休息。后面还有一句'), '今天想早点休息。');
  assert.equal(firstSpeechSegment('还没有完整停顿'), '');
});

test('speech continuation removes exactly the part already spoken', () => {
  assert.equal(
    remainingSpeechText('下午累坏了吧，是开会多还是事情堆在一起了？', '下午累坏了吧，'),
    '是开会多还是事情堆在一起了？'
  );
  assert.equal(remainingSpeechText('同一句话。', ''), '同一句话。');
  assert.equal(remainingSpeechText('回答发生变化。', '另一个开头，'), null);
});
