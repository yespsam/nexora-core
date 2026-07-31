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
