export const SOULMATE_MEMORY_VERSION = 1;
export const SOULMATE_MEMORY_LIMIT = 48;

const memoryTypes = new Set(['preference', 'fact', 'event', 'emotion', 'relationship']);

function cleanText(value, limit = 120) {
  return String(value || '')
    .replace(/[<>&]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, limit);
}

function boundedNumber(value, fallback, min, max) {
  const number = Number(value);
  return Math.max(min, Math.min(max, Number.isFinite(number) ? number : fallback));
}

function memoryType(text) {
  if (/喜欢|最爱|偏爱|讨厌|不喜欢|习惯|更想要|更愿意/.test(text)) return 'preference';
  if (/生日|住在|来自|名字|叫(?:做|作)?|职业|工作是|学校|家人|宠物|我是|我的.+是|我(?:有|没有|在用|正在用)/.test(text)) return 'fact';
  if (/难过|开心|焦虑|压力|生气|害怕|委屈|孤独|疲惫|累了/.test(text)) return 'emotion';
  if (/我们|一起|想你|爱你|谢谢你|陪我|第一次见/.test(text)) return 'relationship';
  return 'event';
}

function memorySummary(text, type) {
  let summary = cleanText(text, 120)
    .replace(/^(?:请)?(?:记住|别忘了)[：:，,\s]*/u, '')
    .replace(/[，,]\s*(?:请)?(?:记住|别忘了)(?:这个|这件)?(?:计划|事情|安排)?[。！!]?$/u, '')
    .replace(/[，,。.\s]*(?:你)?(?:记住了吗|知道了吗|明白了吗)[？?]?$/u, '')
    .trim();
  if (type === 'fact' || type === 'preference') {
    summary = summary.replace(/^我想让你知道[：:，,\s]*/u, '');
  }
  return cleanText(summary, 120);
}

function isQuestionLike(text) {
  return /[？?]/.test(text)
    || /(?:吗|么|呢|什么|哪(?:个|里|些)?|谁|怎么|为什么|是否|能不能|可不可以|有没有|还记得)[呀啊吧]?[。！!]*$/u.test(text);
}

function isMetaPrompt(text) {
  return /(?:连续)?(?:对话|语音|记忆|功能)?测试|不要泛泛回答|请用.{0,24}(?:告诉|回答|说|重复)|(?:回答|重复).{0,12}(?:一句|一遍)/u.test(text);
}

function isDurableEvent(text) {
  return /今天|明天|昨天|刚刚|刚才|这周|下周|周[一二三四五六日天]|准备|计划|决定|完成|开始|去了|要去|发布会|旅行|会议|约会|考试|搬家|买了|做了|看了|吃了|喝了|喝过|工作|学习|项目|下雨|天气/u.test(text);
}

function shouldRemember(text, type) {
  if (!text || isMetaPrompt(text) || isQuestionLike(text)) return false;
  if (/^(?:请)?(?:告诉我|回答我|重复|打开|关闭|播放|发送|执行|控制|帮我|给我)/u.test(text)) {
    return false;
  }
  return type !== 'event' || isDurableEvent(text);
}

function importanceFor(type, text) {
  const base = { preference: 4, fact: 4, relationship: 4, emotion: 3, event: 2 }[type] || 2;
  return Math.min(5, base + (/第一次|生日|永远|重要|记住|最喜欢/.test(text) ? 1 : 0));
}

function fingerprint(value) {
  return cleanText(value, 120)
    .toLowerCase()
    .replace(/[\s，。！？,.!?、:：；;]/g, '')
    .replace(/我真的|我比较|我很|其实|就是|有点/g, '');
}

export function soulmateMemoryFingerprint(value) {
  const summary = typeof value === 'object'
    ? value?.summary || value?.text || value?.sourceText
    : value;
  return fingerprint(summary);
}

function preferenceTopic(value) {
  const firstClause = cleanText(value, 120).split(/[，,。！？!?；;]/u)[0];
  const match = firstClause.match(/(?:不喜欢|最喜欢|喜欢|偏爱|讨厌)(.+)$/u);
  if (!match?.[1]) return '';
  return fingerprint(match[1]
    .replace(/^(?:现在|以前|原来|最近|还是)/u, '')
    .replace(/[了啦吧呀啊]+$/u, ''));
}

export function soulmateMemoryMergeKey(value) {
  const summary = typeof value === 'object'
    ? value?.summary || value?.text || value?.sourceText
    : value;
  const type = memoryTypes.has(value?.type) ? value.type : memoryType(cleanText(summary, 120));
  const topic = type === 'preference' ? preferenceTopic(summary) : '';
  return `${type}:${topic || fingerprint(summary)}`;
}

function memoryId(type, text, createdAt) {
  const seed = `${type}:${fingerprint(text)}:${createdAt}`;
  let hash = 2166136261;
  for (const char of seed) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `memory-${Math.abs(hash >>> 0).toString(36)}`;
}

export function normalizeSoulmateMemory(value, now = Date.now(), index = 0) {
  if (!value || typeof value !== 'object') return null;
  const originalSummary = cleanText(value.summary || value.text || value.sourceText, 120);
  if (!originalSummary) return null;
  const type = memoryTypes.has(value.type) ? value.type : memoryType(originalSummary);
  if (!shouldRemember(originalSummary, type)) return null;
  const summary = memorySummary(originalSummary, type);
  if (!summary) return null;
  const createdAt = boundedNumber(value.createdAt, now + index, 0, now);
  return {
    version: SOULMATE_MEMORY_VERSION,
    id: cleanText(value.id, 64) || memoryId(type, summary, createdAt),
    type,
    summary,
    sourceText: cleanText(value.sourceText || value.text || summary, 120),
    importance: boundedNumber(value.importance, importanceFor(type, summary), 1, 5),
    createdAt,
    updatedAt: boundedNumber(value.updatedAt, createdAt, createdAt, now),
    mentionCount: boundedNumber(value.mentionCount, 1, 1, 999)
  };
}

export function normalizeSoulmateMemories(values, now = Date.now()) {
  if (!Array.isArray(values)) return [];
  const normalized = values
    .map((value, index) => normalizeSoulmateMemory(value, now, index))
    .filter(Boolean);
  const merged = new Map();
  for (const memory of normalized) {
    const key = soulmateMemoryMergeKey(memory);
    const current = merged.get(key);
    if (!current) {
      merged.set(key, memory);
      continue;
    }
    const latest = memory.updatedAt >= current.updatedAt ? memory : current;
    merged.set(key, {
      ...latest,
      id: current.id,
      importance: Math.max(current.importance, memory.importance),
      createdAt: Math.min(current.createdAt, memory.createdAt),
      updatedAt: Math.max(current.updatedAt, memory.updatedAt),
      mentionCount: Math.max(current.mentionCount, memory.mentionCount)
    });
  }
  const retained = [...merged.values()]
    .sort((left, right) => right.importance - left.importance
      || right.updatedAt - left.updatedAt
      || right.createdAt - left.createdAt)
    .slice(0, SOULMATE_MEMORY_LIMIT);
  return retained.sort((left, right) => left.createdAt - right.createdAt);
}

export function extractSoulmateMemory(text, now = Date.now()) {
  const sourceText = cleanText(text, 120);
  if (sourceText.length < 4 || /^(你好|嗨|哈喽|在吗|晚安|早上好)[呀啊。！!，, ]*$/.test(sourceText)) return null;
  const type = memoryType(sourceText);
  if (!shouldRemember(sourceText, type)) return null;
  const summary = memorySummary(sourceText, type);
  if (!summary) return null;
  return normalizeSoulmateMemory({
    type,
    summary,
    sourceText,
    importance: importanceFor(type, summary),
    createdAt: now,
    updatedAt: now,
    mentionCount: 1
  }, now);
}

export function rememberSoulmateInteraction(values, text, now = Date.now()) {
  const memories = normalizeSoulmateMemories(values, now);
  const candidate = extractSoulmateMemory(text, now);
  if (!candidate) return memories;
  const key = soulmateMemoryMergeKey(candidate);
  const existingIndex = memories.findIndex((memory) => soulmateMemoryMergeKey(memory) === key);
  if (existingIndex >= 0) {
    const existing = memories[existingIndex];
    memories[existingIndex] = {
      ...existing,
      type: candidate.type,
      summary: candidate.summary,
      sourceText: candidate.sourceText,
      importance: Math.max(existing.importance, candidate.importance),
      updatedAt: now,
      mentionCount: Math.min(999, existing.mentionCount + 1)
    };
  } else {
    memories.push(candidate);
  }
  return normalizeSoulmateMemories(memories, now);
}

function queryTokens(value) {
  return new Set([...fingerprint(value)].filter((char) => !/[的了是在和我你他她它这那有就都也]/.test(char)));
}

export function recallSoulmateMemories(values, query = '', limit = 6, now = Date.now()) {
  const memories = normalizeSoulmateMemories(values, now);
  const tokens = queryTokens(query);
  return [...memories]
    .map((memory) => {
      const memoryTokens = queryTokens(memory.summary);
      let overlap = 0;
      for (const token of tokens) if (memoryTokens.has(token)) overlap += 1;
      const ageDays = Math.max(0, (now - memory.updatedAt) / 86400000);
      const recency = Math.max(0, 8 - Math.log2(ageDays + 1) * 2);
      const durable = ['preference', 'fact', 'relationship'].includes(memory.type) ? 3 : 0;
      return { memory, score: memory.importance * 6 + overlap * 5 + recency + durable };
    })
    .sort((left, right) => right.score - left.score || right.memory.updatedAt - left.memory.updatedAt)
    .slice(0, Math.max(1, Math.min(12, Number(limit) || 6)))
    .map(({ memory }) => memory);
}
