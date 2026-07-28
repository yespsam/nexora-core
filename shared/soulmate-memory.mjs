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
  if (/生日|住在|来自|名字|叫(?:做|作)?|职业|工作是|学校|家人|宠物/.test(text)) return 'fact';
  if (/难过|开心|焦虑|压力|生气|害怕|委屈|孤独|疲惫|累了/.test(text)) return 'emotion';
  if (/我们|一起|想你|爱你|谢谢你|陪我|第一次见/.test(text)) return 'relationship';
  return 'event';
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
  const summary = cleanText(value.summary || value.text || value.sourceText, 120);
  if (!summary) return null;
  const type = memoryTypes.has(value.type) ? value.type : memoryType(summary);
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
  const retained = [...normalized]
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
  return normalizeSoulmateMemory({
    type,
    summary: sourceText,
    sourceText,
    importance: importanceFor(type, sourceText),
    createdAt: now,
    updatedAt: now,
    mentionCount: 1
  }, now);
}

export function rememberSoulmateInteraction(values, text, now = Date.now()) {
  const memories = normalizeSoulmateMemories(values, now);
  const candidate = extractSoulmateMemory(text, now);
  if (!candidate) return memories;
  const key = fingerprint(candidate.summary);
  const existingIndex = memories.findIndex((memory) => fingerprint(memory.summary) === key);
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
