export function parseChatStreamEvent(block) {
  const lines = String(block || '').split(/\r?\n/);
  const event = lines.find((line) => line.startsWith('event:'))?.slice(6).trim() || 'message';
  const payload = lines
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart())
    .join('\n');
  if (!payload) return null;
  try {
    return { event, data: JSON.parse(payload) };
  } catch (error) {
    return null;
  }
}

export function appendChatStreamDelta(current, delta, maxLength = 300) {
  return `${String(current || '')}${String(delta || '')}`
    .replace(/\s+/g, ' ')
    .slice(0, Math.max(1, Number(maxLength) || 300));
}

export function firstSpeechSegment(value, minLength = 7) {
  const text = String(value || '').replace(/\s+/g, ' ').trimStart();
  const punctuation = /[。！？!?；;，,]/gu;
  for (const match of text.matchAll(punctuation)) {
    const segment = text.slice(0, match.index + match[0].length).trim();
    if (segment.replace(/\s/g, '').length >= minLength) return segment;
  }
  return '';
}

export function remainingSpeechText(fullReply, spokenSegment) {
  const full = String(fullReply || '').replace(/\s+/g, ' ').trim();
  const spoken = String(spokenSegment || '').replace(/\s+/g, ' ').trim();
  if (!spoken) return full;
  if (!full.startsWith(spoken)) return null;
  return full.slice(spoken.length).trim();
}
