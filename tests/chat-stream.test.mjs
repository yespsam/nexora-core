import test from 'node:test';
import assert from 'node:assert/strict';

import {
  appendChatStreamDelta,
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
