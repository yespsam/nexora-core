export function normalizeSpeech(value) {
  return String(value || '').replace(/[\s，。！？,.!?]/g, '').toLowerCase();
}

export const VOICE_LISTEN_TIMEOUT_MS = 12000;
export const VOICE_WAKE_COMMAND_WINDOW_MS = 8000;

const VOICE_ACTIONS = Object.freeze([
  Object.freeze({
    action: 'wave',
    phrases: Object.freeze(['招手', '招招手', '张手', '招收', '挥手', '挥挥手', '摆摆手', '打招呼', 'wave'])
  }),
  Object.freeze({ action: 'nod', phrases: Object.freeze(['点头', '点点头', 'nod']) }),
  Object.freeze({ action: 'affection', phrases: Object.freeze(['靠近', '过来', '贴近', '抱抱']) }),
  Object.freeze({ action: 'walk', phrases: Object.freeze(['走路', '走一走', '散步', '向前走', 'walk']) }),
  Object.freeze({ action: 'run', phrases: Object.freeze(['跑步', '跑起来', '快跑', 'run']) }),
  Object.freeze({ action: 'idle', phrases: Object.freeze(['停下', '停止', '别动', '待机', '休息', 'stop']) })
]);

export function voiceWakeWords(name = '', starter = 'cute') {
  const routeName = {
    cute: '露莫',
    cool: '维尔',
    beautiful: '艾拉'
  }[starter] || '露莫';
  return [...new Set([
    name,
    routeName,
    '奈索拉',
    '耐索拉',
    '内索拉',
    '尼索拉',
    'nexora',
    'soulmate',
    '伙伴'
  ]
    .map(normalizeSpeech)
    .filter((word) => word.length >= 2))];
}

export function parseVoiceControlCommand(text, {
  wakeWords = [],
  wakeActive = false
} = {}) {
  const normalized = normalizeSpeech(text);
  if (!normalized) return null;
  const normalizedWakeWords = wakeWords
    .map(normalizeSpeech)
    .filter((word) => word.length >= 2)
    .sort((left, right) => right.length - left.length);
  const matchedWakeWord = normalizedWakeWords.find((word) => normalized.includes(word)) || '';
  const awakened = Boolean(wakeActive || matchedWakeWord);
  if (!awakened) return null;
  const remainder = matchedWakeWord
    ? normalized.replace(matchedWakeWord, '')
    : normalized;
  const matchedAction = VOICE_ACTIONS.find((entry) => entry.phrases
    .some((phrase) => remainder.includes(normalizeSpeech(phrase))));
  if (matchedAction) {
    return {
      type: 'action',
      action: matchedAction.action,
      wakeWord: matchedWakeWord,
      remainder
    };
  }
  return {
    type: remainder ? 'message' : 'wake',
    wakeWord: matchedWakeWord,
    remainder
  };
}

function boundedRecognitionText(value) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 160);
}

export function recognitionCandidates(results, limit = 5) {
  const finalResults = Array.from(results || [])
    .filter((result) => result?.isFinal !== false && Number(result?.length) > 0);
  if (!finalResults.length) return [];
  const alternativeCount = Math.min(
    Math.max(1, Number(limit) || 1),
    Math.max(...finalResults.map((result) => Number(result.length) || 1))
  );
  const candidates = [];
  const seen = new Set();
  for (let index = 0; index < alternativeCount; index += 1) {
    const alternatives = finalResults.map((result) => result[index] || result[0]);
    const text = boundedRecognitionText(alternatives
      .map((alternative) => alternative?.transcript)
      .filter(Boolean)
      .join(' '));
    const key = normalizeSpeech(text);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const confidences = alternatives
      .map((alternative) => Number(alternative?.confidence) || 0)
      .filter((confidence) => confidence > 0);
    candidates.push({
      text,
      confidence: confidences.length
        ? confidences.reduce((total, confidence) => total + confidence, 0) / confidences.length
        : 0
    });
  }
  return candidates;
}

function voiceCommandPriority(command) {
  if (command?.type === 'action') return 4;
  if (command?.wakeWord && command.type === 'message') return 3;
  if (command?.type === 'wake') return 2;
  if (command?.type === 'message') return 1;
  return 0;
}

export function resolveVoiceRecognition(results, {
  wakeWords = [],
  wakeActive = false
} = {}) {
  const candidates = recognitionCandidates(results);
  if (!candidates.length) {
    return { text: '', confidence: 0, command: null, candidates: [] };
  }
  const ranked = candidates.map((candidate, index) => {
    const command = parseVoiceControlCommand(candidate.text, { wakeWords, wakeActive });
    return {
      ...candidate,
      command,
      index,
      priority: voiceCommandPriority(command)
    };
  }).sort((left, right) => (
    right.priority - left.priority
    || right.confidence - left.confidence
    || left.index - right.index
  ));
  const selected = ranked[0];
  return {
    text: selected.text,
    confidence: selected.confidence,
    command: selected.command,
    candidates
  };
}

export function recognitionTranscript(results) {
  return recognitionCandidates(results, 1)[0]?.text || '';
}

export function recognitionFailureMessage(code) {
  const normalized = String(code || '').toLowerCase();
  if (normalized === 'aborted') return '';
  if (normalized === 'not-allowed' || normalized === 'service-not-allowed') {
    return '需要允许麦克风权限，才能听见你。';
  }
  if (normalized === 'audio-capture') return '没有找到可用的麦克风。';
  if (normalized === 'no-speech') return '这次没有听清，再说一次吧。';
  if (normalized === 'network') return '语音识别网络暂时不可用，请稍后重试。';
  return '语音识别暂时不可用，请改用文字输入。';
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
