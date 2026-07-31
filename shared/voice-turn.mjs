export function normalizeSpeech(value) {
  return String(value || '').replace(/[\s，。！？,.!?]/g, '').toLowerCase();
}

function speechBigrams(value) {
  const grams = new Set();
  for (let index = 0; index < value.length - 1; index += 1) {
    grams.add(value.slice(index, index + 2));
  }
  return grams;
}

export function speechOverlapRatio(left, right) {
  const first = normalizeSpeech(left);
  const second = normalizeSpeech(right);
  if (first.length < 2 || second.length < 2) return 0;
  if (first === second) return 1;
  const firstGrams = speechBigrams(first);
  const secondGrams = speechBigrams(second);
  let overlap = 0;
  firstGrams.forEach((gram) => {
    if (secondGrams.has(gram)) overlap += 1;
  });
  return overlap / Math.max(1, Math.min(firstGrams.size, secondGrams.size));
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
  if (heard.length < 2 || spoken.length < 2) return false;
  if (heard.length < 4 || spoken.length < 4) {
    return now - lastAssistantAt <= 12000 && spoken.includes(heard);
  }
  return spoken.includes(heard)
    || heard.includes(spoken)
    || speechOverlapRatio(heard, spoken) >= 0.64;
}

export function voiceControlState({
  recognitionSupported = false,
  phase = 'idle',
  busy = false,
  hasVoiceOutput = false
} = {}) {
  if (!recognitionSupported) {
    return {
      disabled: true,
      label: '不可用',
      ariaLabel: '当前浏览器不支持语音识别，请使用文字输入',
      pressed: false
    };
  }
  if (phase === 'listening') {
    return {
      disabled: false,
      label: '停止',
      ariaLabel: '停止语音输入',
      pressed: true
    };
  }
  const interruptible = !busy && (hasVoiceOutput || ['speaking', 'ready'].includes(phase));
  return {
    disabled: busy,
    label: interruptible ? '打断' : '说话',
    ariaLabel: interruptible ? '打断回答并开始说话' : '开始语音输入',
    pressed: false
  };
}
