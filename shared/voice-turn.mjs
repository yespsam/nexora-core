export function normalizeSpeech(value) {
  return String(value || '').replace(/[\s，。！？,.!?]/g, '').toLowerCase();
}

export function shouldBlockRecognizedSpeech({
  text,
  lastAssistantText = '',
  lastAssistantAt = 0,
  echoGuardUntil = 0,
  now = Date.now()
}) {
  if (now < echoGuardUntil) return true;
  if (!lastAssistantText || now - lastAssistantAt > 60000) return false;
  const heard = normalizeSpeech(text);
  const spoken = normalizeSpeech(lastAssistantText);
  if (heard.length < 4 || spoken.length < 4) return false;
  return spoken.includes(heard)
    || heard.includes(spoken.slice(0, Math.min(heard.length, spoken.length)));
}
