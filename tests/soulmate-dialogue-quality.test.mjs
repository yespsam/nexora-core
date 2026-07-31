import assert from 'node:assert/strict';
import test from 'node:test';

import {
  contextualFallbackReply,
  inferSceneId
} from '../shared/fallback-dialogue.mjs';
import { buildLLMMessages } from '../netlify/functions/chat.mjs';

const scenarios = [
  ['今天中午吃了很辣的火锅', 'daily'],
  ['我终于下班了', 'daily'],
  ['刚刚把产品方案做完了', 'daily'],
  ['明天下午三点要去看牙医', 'daily'],
  ['下周六想去看展', 'walk'],
  ['今天路上看见一只很可爱的猫', 'daily'],
  ['早上咖啡洒在电脑上了', 'daily'],
  ['今天开会比预计顺利', 'daily'],
  ['我刚换了新的桌面壁纸', 'daily'],
  ['今晚想自己做饭', 'daily'],
  ['今天被老板批评了', 'comfort'],
  ['我和朋友吵架了', 'comfort'],
  ['考试没考好，有点难受', 'comfort'],
  ['最近总觉得很焦虑', 'comfort'],
  ['项目延期让我压力很大', 'comfort'],
  ['今天一个人回家有点孤独', 'comfort'],
  ['我有点害怕明天的面试', 'comfort'],
  ['刚才那句话让我很委屈', 'comfort'],
  ['累得什么都不想做', 'comfort'],
  ['今天心情其实很好', 'daily'],
  ['有点想你了', 'miss'],
  ['想抱抱你', 'miss'],
  ['晚安，明天见', 'goodnight'],
  ['我准备睡觉了', 'goodnight'],
  ['陪我出去散散步吧', 'walk'],
  ['今天工作先做哪一步？', 'focus'],
  ['我要开始学习了', 'focus'],
  ['我最喜欢周末喝热可可', 'daily'],
  ['你还记得我的猫叫什么吗？', 'daily'],
  ['我刚才说了什么？', 'daily']
];

test('thirty relationship scenarios map to coherent scenes and safe creature replies', () => {
  assert.equal(scenarios.length, 30);
  scenarios.forEach(([text, expectedScene], index) => {
    assert.equal(inferSceneId(text, 'daily'), expectedScene, text);
    const reply = contextualFallbackReply({
      text,
      kind: `creature:${['cute', 'cool', 'beautiful'][index % 3]}`,
      scene: expectedScene,
      history: [
        { role: 'user', content: '今天事情有点多。' },
        { role: 'assistant', content: '先说你最在意的那一件。' }
      ],
      memories: ['我的猫叫年糕', '我最喜欢周末喝热可可']
    });
    assert.ok(reply.length >= 4 && reply.length <= 180, text);
    assert.doesNotMatch(reply, /主人|小栖|栖安|作为一个AI/u, text);
  });
});

test('personality prompt preserves five recent turns and relationship boundaries', () => {
  const history = Array.from({ length: 12 }, (_, index) => ({
    role: index % 2 ? 'assistant' : 'user',
    content: `连续对话 ${index + 1}`
  }));
  const messages = buildLLMMessages('那后来呢？', 'creature:beautiful', history, {
    name: '星澜',
    starterId: 'beautiful',
    species: '月羽灵',
    stage: '月华共鸣体',
    daysTogether: 90,
    bond: 320,
    interactions: 168,
    traits: {
      warmth: 82,
      curiosity: 63,
      steadiness: 71,
      courage: 56,
      independence: 48
    },
    memories: ['我的猫叫年糕', '我现在不喜欢喝咖啡了']
  });

  assert.equal(messages.length, 12);
  assert.equal(messages[1].content, '连续对话 3');
  assert.equal(messages.at(-1).content, '那后来呢？');
  assert.match(messages[0].content, /深度共鸣/);
  assert.match(messages[0].content, /不重新开场/);
  assert.match(messages[0].content, /不冒充人类恋人/);
  assert.match(messages[0].content, /我现在不喜欢喝咖啡了/);
});
