import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SOULMATE_MEMORY_LIMIT,
  extractSoulmateMemory,
  normalizeSoulmateMemories,
  recallSoulmateMemories,
  rememberSoulmateInteraction
} from '../shared/soulmate-memory.mjs';

test('memory engine classifies durable relationship facts and preferences', () => {
  assert.equal(extractSoulmateMemory('我最喜欢在雨天喝热可可', 1000).type, 'preference');
  assert.equal(extractSoulmateMemory('我的生日是七月二十八日', 1000).type, 'fact');
  assert.equal(extractSoulmateMemory('今天工作压力很大', 1000).type, 'emotion');
  assert.equal(extractSoulmateMemory('我们第一次一起看了日落', 1000).type, 'relationship');
  assert.equal(extractSoulmateMemory('你好', 1000), null);
});

test('memory engine merges repeated memories instead of filling the store', () => {
  let memories = rememberSoulmateInteraction([], '我最喜欢在雨天喝热可可', 1000);
  memories = rememberSoulmateInteraction(memories, '我最喜欢在雨天喝热可可', 2000);
  assert.equal(memories.length, 1);
  assert.equal(memories[0].mentionCount, 2);
  assert.equal(memories[0].updatedAt, 2000);
});

test('memory engine keeps important facts when low-value events exceed the limit', () => {
  let memories = rememberSoulmateInteraction([], '请记住我的生日是七月二十八日', 1000);
  for (let index = 0; index < SOULMATE_MEMORY_LIMIT + 12; index += 1) {
    memories = rememberSoulmateInteraction(memories, `今天完成了普通任务第${index}项`, 2000 + index);
  }
  assert.equal(memories.length, SOULMATE_MEMORY_LIMIT);
  assert.ok(memories.some((memory) => memory.type === 'fact' && /生日/.test(memory.summary)));
});

test('memory recall selects context relevant memories and stays compact', () => {
  const memories = normalizeSoulmateMemories([
    { text: '我喜欢雨天喝热可可', createdAt: 1000 },
    { text: '我的猫叫年糕', createdAt: 2000 },
    { text: '今天整理了桌面文件', createdAt: 3000 },
    { text: '我们第一次一起看了日落', createdAt: 4000 }
  ], 5000);
  const recalled = recallSoulmateMemories(memories, '你还记得我的猫叫什么吗', 2, 6000);
  assert.equal(recalled.length, 2);
  assert.match(recalled[0].summary, /猫叫年糕/);
});

test('legacy text memories migrate to the versioned schema', () => {
  const [memory] = normalizeSoulmateMemories([{ text: '我喜欢安静的音乐', createdAt: 1000 }], 2000);
  assert.equal(memory.version, 1);
  assert.equal(memory.type, 'preference');
  assert.equal(memory.summary, '我喜欢安静的音乐');
  assert.ok(memory.id.startsWith('memory-'));
});
