import {
  SOULMATE_HISTORY_KEY,
  SOULMATE_STORAGE_KEY,
  createSoulmateProfile,
  growSoulmate,
  normalizeSoulmateProfile,
  soulmatePromptProfile,
  soulmateStages,
  stageProgress
} from '../shared/soulmate-profile.mjs';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const birthFlow = $('#birth-flow');
const companionView = $('#companion-view');
const birthForm = $('#birth-form');
const birthName = $('#birth-name');
const birthDate = $('#birth-date');
const birthStepLabel = $('#birth-step-label');
const birthBack = $('#birth-back');
const birthNext = $('#birth-next');
const voicePreview = $('#voice-preview');
const identityLine = $('#identity-line');
const stageName = $('#stage-name');
const bondLabel = $('#bond-label');
const bondTrackValue = $('#bond-track-value');
const companionTouch = $('#companion-touch');
const companionImage = $('#companion-image');
const presenceLine = $('#presence-line');
const conversationStateLabel = $('#conversation-state-label');
const messageList = $('#message-list');
const composer = $('#composer');
const chatInput = $('#chat-input');
const micButton = $('#mic-button');
const queuedAudioButton = $('#queued-audio');
const growthSheet = $('#growth-sheet');
const deviceSheet = $('#device-sheet');
const settingsSheet = $('#settings-sheet');
const evolutionList = $('#evolution-list');
const traitList = $('#trait-list');
const memoryList = $('#memory-list');
const growthTitle = $('#growth-title');
const bluetoothButton = $('#bluetooth-button');
const bluetoothStatus = $('#bluetooth-status');
const bridgeButton = $('#bridge-button');
const bridgeStatus = $('#bridge-status');

const phaseLabels = {
  idle: '待机',
  listening: '正在听你说',
  thinking: '正在思考',
  speaking: '正在回答',
  ready: '点击播放',
  error: '网络未连接'
};

const voiceNames = {
  soft: '轻柔',
  bright: '清亮',
  steady: '安定'
};

const traitNames = {
  warmth: '温柔',
  curiosity: '好奇',
  steadiness: '沉稳',
  courage: '勇气',
  independence: '独立'
};

const state = {
  birthStep: 0,
  birthSelections: {
    gender: 'neutral',
    temperament: 'warm',
    voice: 'soft'
  },
  profile: null,
  history: [],
  phase: 'idle',
  busy: false,
  touchRewards: 0,
  careRewards: 0,
  recognition: null,
  currentAudio: null,
  currentAudioUrl: '',
  queuedAudio: null,
  queuedAudioUrl: '',
  lastAssistantText: '',
  lastAssistantAt: 0,
  currentStageId: ''
};

function safeRead(key) {
  try {
    return JSON.parse(localStorage.getItem(key) || 'null');
  } catch (error) {
    return null;
  }
}

function safeWrite(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (error) {
    return false;
  }
}

function cleanMessage(value) {
  const role = value?.role === 'assistant' ? 'assistant' : value?.role === 'user' ? 'user' : '';
  const content = String(value?.content || '').replace(/\s+/g, ' ').trim().slice(0, 300);
  return role && content ? { role, content } : null;
}

function loadProfile() {
  if (new URLSearchParams(location.search).get('reset') === '1') {
    localStorage.removeItem(SOULMATE_STORAGE_KEY);
    localStorage.removeItem(SOULMATE_HISTORY_KEY);
    history.replaceState({}, '', location.pathname);
    return null;
  }
  return normalizeSoulmateProfile(safeRead(SOULMATE_STORAGE_KEY));
}

function loadHistory() {
  const saved = safeRead(SOULMATE_HISTORY_KEY);
  return Array.isArray(saved) ? saved.map(cleanMessage).filter(Boolean).slice(-12) : [];
}

function saveProfile() {
  if (state.profile) safeWrite(SOULMATE_STORAGE_KEY, state.profile);
}

function saveHistory() {
  safeWrite(SOULMATE_HISTORY_KEY, state.history.slice(-12));
}

function personaFromGender(gender = state.profile?.gender || state.birthSelections.gender) {
  return gender === 'male' ? 'male' : 'female';
}

function voiceArchetype(voice = state.profile?.voice || state.birthSelections.voice) {
  const male = personaFromGender() === 'male';
  if (voice === 'bright') return male ? 'shonen' : 'loli';
  if (voice === 'steady') return male ? 'uncle' : 'yujie';
  return '';
}

function setPhase(phase) {
  state.phase = phase;
  companionView.dataset.conversationPhase = phase;
  conversationStateLabel.textContent = phaseLabels[phase] || phaseLabels.idle;
  micButton.textContent = phase === 'listening' ? '停止' : '说话';
  micButton.setAttribute('aria-pressed', phase === 'listening' ? 'true' : 'false');
}

function showBirthStep(index) {
  state.birthStep = Math.max(0, Math.min(3, index));
  $$('.birth-step').forEach((step, stepIndex) => {
    step.hidden = stepIndex !== state.birthStep;
    step.classList.toggle('active', stepIndex === state.birthStep);
  });
  birthStepLabel.textContent = `${String(state.birthStep + 1).padStart(2, '0')} / 04`;
  birthBack.disabled = state.birthStep === 0;
  birthNext.textContent = state.birthStep === 3 ? '让它诞生' : '继续';
  if (state.birthStep === 0) window.setTimeout(() => birthName.focus(), 120);
}

function selectChoice(group, value) {
  state.birthSelections[group] = value;
  $$(`[data-choice="${group}"]`).forEach((button) => {
    button.classList.toggle('active', button.dataset.value === value);
    button.setAttribute('aria-pressed', button.dataset.value === value ? 'true' : 'false');
  });
}

function validateBirthStep() {
  if (state.birthStep === 0 && !birthName.value.trim()) {
    birthName.setCustomValidity('请先为它取一个名字');
    birthName.reportValidity();
    birthName.setCustomValidity('');
    return false;
  }
  if (state.birthStep === 1 && !birthDate.value) {
    birthDate.reportValidity();
    return false;
  }
  return true;
}

function completeBirth() {
  state.profile = createSoulmateProfile({
    name: birthName.value,
    birthday: birthDate.value,
    ...state.birthSelections
  });
  state.history = [{
    role: 'assistant',
    content: `我醒了。我会记住今天，也会记住你给我的名字——${state.profile.name}。`
  }];
  saveProfile();
  saveHistory();
  birthFlow.hidden = true;
  companionView.hidden = false;
  renderMessages();
  renderCompanion();
  speakText(state.history[0].content, { allowQueue: true });
}

function appendMessage(role, content) {
  const message = cleanMessage({ role, content });
  if (!message) return;
  state.history = [...state.history, message].slice(-12);
  saveHistory();
  renderMessages();
}

function renderMessages() {
  messageList.textContent = '';
  state.history.slice(-2).forEach((message) => {
    const paragraph = document.createElement('p');
    paragraph.className = `message ${message.role}`;
    paragraph.textContent = message.content;
    messageList.appendChild(paragraph);
  });
}

function updateProfile(next) {
  if (!next) return;
  state.profile = next;
  saveProfile();
  renderCompanion();
}

function renderCompanion() {
  if (!state.profile) return;
  const progress = stageProgress(state.profile);
  identityLine.textContent = `${state.profile.name} · 第 ${state.profile.daysTogether} 天`;
  stageName.textContent = progress.stage.name;
  bondLabel.textContent = `共鸣 ${state.profile.bond}`;
  bondTrackValue.style.width = `${Math.round(progress.progress * 100)}%`;
  companionImage.alt = `${state.profile.name}的${progress.stage.name}形象`;
  if (state.currentStageId !== progress.stage.id) {
    state.currentStageId = progress.stage.id;
    companionImage.style.opacity = '0';
    window.setTimeout(() => {
      companionImage.src = progress.stage.asset;
      companionImage.onload = () => { companionImage.style.opacity = '1'; };
    }, 120);
  }
  $('#setting-voice').textContent = voiceNames[state.profile.voice] || voiceNames.soft;
  $('#setting-birthday').textContent = state.profile.birthday;
  renderGrowth();
}

function renderGrowth() {
  if (!state.profile) return;
  const progress = stageProgress(state.profile);
  growthTitle.textContent = progress.stage.name;
  evolutionList.textContent = '';
  soulmateStages.forEach((stage) => {
    const item = document.createElement('div');
    const unlocked = state.profile.bond >= stage.minBond;
    item.className = `evolution-item${stage.id === progress.stage.id ? ' active' : ''}${unlocked ? ' unlocked' : ''}`;
    const image = document.createElement('img');
    image.src = stage.asset;
    image.alt = stage.name;
    const title = document.createElement('strong');
    title.textContent = stage.name;
    const status = document.createElement('span');
    status.textContent = unlocked ? (stage.id === progress.stage.id ? '当前形态' : '已经历') : `共鸣 ${stage.minBond} 解锁`;
    item.append(image, title, status);
    evolutionList.appendChild(item);
  });

  traitList.textContent = '';
  Object.entries(state.profile.traits).forEach(([id, value]) => {
    const row = document.createElement('div');
    row.className = 'trait-row';
    const label = document.createElement('span');
    label.textContent = traitNames[id] || id;
    const track = document.createElement('span');
    track.className = 'trait-track';
    const fill = document.createElement('span');
    fill.style.width = `${value}%`;
    track.appendChild(fill);
    const number = document.createElement('span');
    number.textContent = Math.round(value);
    row.append(label, track, number);
    traitList.appendChild(row);
  });

  memoryList.textContent = '';
  const memories = state.profile.memories.slice(-4).reverse();
  if (!memories.length) {
    const empty = document.createElement('p');
    empty.className = 'memory-line';
    empty.textContent = '还没有长期记忆。从第一次真正的对话开始吧。';
    memoryList.appendChild(empty);
    return;
  }
  memories.forEach((memory) => {
    const line = document.createElement('p');
    line.className = 'memory-line';
    line.textContent = memory.text;
    memoryList.appendChild(line);
  });
}

function reactToTouch(kind) {
  companionTouch.classList.remove('interacting');
  void companionTouch.offsetWidth;
  companionTouch.classList.add('interacting');
  const rewardAllowed = kind === 'care' ? state.careRewards < 2 : state.touchRewards < 5;
  if (kind === 'care') state.careRewards += 1;
  else state.touchRewards += 1;
  if (rewardAllowed) updateProfile(growSoulmate(state.profile, { kind }));
  const lines = kind === 'care'
    ? ['它认真地看着你。', '它把这份关心收进了心里。']
    : ['它轻轻贴近了你。', '它舒服地眯起眼睛。', '它记住了你的触碰。'];
  presenceLine.textContent = lines[(state.profile.interactions + lines.length) % lines.length];
  window.setTimeout(() => companionTouch.classList.remove('interacting'), 700);
}

function normalizeSpeech(value) {
  return String(value || '').replace(/[\s，。！？,.!?]/g, '').toLowerCase();
}

function looksLikeEcho(text) {
  if (!state.lastAssistantText || Date.now() - state.lastAssistantAt > 12000) return false;
  const heard = normalizeSpeech(text);
  const spoken = normalizeSpeech(state.lastAssistantText);
  return heard.length >= 4 && (spoken.includes(heard) || heard.includes(spoken.slice(0, Math.min(heard.length, spoken.length))));
}

function fallbackReply(text) {
  const name = state.profile.name;
  if (/[累难过压力烦害怕]/.test(text)) return '我听见了。你不用立刻变好，先让我安静地陪你一会儿。';
  if (/[晚安睡觉困]/.test(text)) return `晚安。${name}会把今天记住，明天醒来再继续陪你。`;
  if (/[你是谁叫什么]/.test(text)) return `我是${name}，是你在 ${state.profile.birthday} 唤醒的 Soulmate。`;
  return '我正在认真记住你刚才说的话。再多告诉我一点，我会越来越懂你。';
}

async function requestReply(text) {
  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text,
      persona: personaFromGender(),
      persona_short: personaFromGender(),
      relationship: 'companion',
      scene: 'daily',
      history: state.history.slice(0, -1),
      soulmate: soulmatePromptProfile(state.profile)
    })
  });
  if (!response.ok) throw new Error(`chat ${response.status}`);
  const body = await response.json();
  const reply = String(body.text || body.reply || '').replace(/\s+/g, ' ').trim().slice(0, 300);
  if (!reply) throw new Error('empty reply');
  return { reply, mood: body.emotion?.mood || 'calm' };
}

async function sendMessage(rawText) {
  const text = String(rawText || '').replace(/\s+/g, ' ').trim().slice(0, 160);
  if (!text || state.busy || looksLikeEcho(text)) return;
  stopListening();
  stopAudio();
  state.busy = true;
  chatInput.value = '';
  appendMessage('user', text);
  updateProfile(growSoulmate(state.profile, { kind: 'chat', text }));
  setPhase('thinking');
  presenceLine.textContent = `${state.profile.name}正在理解你的话……`;
  let result;
  try {
    result = await requestReply(text);
  } catch (error) {
    result = { reply: fallbackReply(text), mood: 'calm' };
  }
  appendMessage('assistant', result.reply);
  state.lastAssistantText = result.reply;
  state.lastAssistantAt = Date.now();
  presenceLine.textContent = result.reply;
  state.busy = false;
  await speakText(result.reply, { mood: result.mood, allowQueue: true });
}

async function fetchVoice(text, mood = 'happy') {
  const response = await fetch('/api/voice/speak', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text,
      persona: personaFromGender(),
      relationship: 'companion',
      mood,
      archetype: voiceArchetype()
    })
  });
  const type = response.headers.get('content-type') || '';
  if (!response.ok || !type.includes('audio')) throw new Error(`voice ${response.status}`);
  return response.blob();
}

function clearQueuedAudio() {
  if (state.queuedAudioUrl) URL.revokeObjectURL(state.queuedAudioUrl);
  state.queuedAudio = null;
  state.queuedAudioUrl = '';
  queuedAudioButton.hidden = true;
}

function stopAudio() {
  if (state.currentAudio) {
    state.currentAudio.pause();
    state.currentAudio.removeAttribute('src');
  }
  if (state.currentAudioUrl) URL.revokeObjectURL(state.currentAudioUrl);
  state.currentAudio = null;
  state.currentAudioUrl = '';
}

async function playAudioBlob(blob, allowQueue = true) {
  stopListening();
  stopAudio();
  clearQueuedAudio();
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);
  audio.playsInline = true;
  state.currentAudio = audio;
  state.currentAudioUrl = url;
  audio.onended = () => {
    stopAudio();
    setPhase('idle');
  };
  audio.onerror = () => {
    stopAudio();
    setPhase('error');
  };
  setPhase('speaking');
  try {
    await audio.play();
  } catch (error) {
    stopAudio();
    if (!allowQueue) {
      setPhase('error');
      return;
    }
    state.queuedAudio = blob;
    state.queuedAudioUrl = URL.createObjectURL(blob);
    queuedAudioButton.hidden = false;
    setPhase('ready');
  }
}

async function speakText(text, { mood = 'happy', allowQueue = false } = {}) {
  stopListening();
  setPhase('thinking');
  try {
    const blob = await fetchVoice(text, mood);
    await playAudioBlob(blob, allowQueue);
  } catch (error) {
    setPhase('idle');
  }
}

function setupRecognition() {
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Recognition) {
    micButton.title = '当前浏览器不支持语音识别';
    return;
  }
  const recognition = new Recognition();
  recognition.lang = 'zh-CN';
  recognition.continuous = false;
  recognition.interimResults = false;
  recognition.onresult = (event) => {
    const text = event.results?.[0]?.[0]?.transcript || '';
    stopListening();
    if (looksLikeEcho(text)) {
      presenceLine.textContent = '已阻止语音回声，没有将它当成你的话。';
      return;
    }
    sendMessage(text);
  };
  recognition.onerror = () => {
    if (state.phase === 'listening') setPhase('idle');
  };
  recognition.onend = () => {
    if (state.phase === 'listening') setPhase('idle');
  };
  state.recognition = recognition;
}

function startListening() {
  if (!state.recognition || state.busy || ['thinking', 'speaking', 'ready'].includes(state.phase)) return;
  if (state.phase === 'listening') {
    stopListening();
    return;
  }
  stopAudio();
  try {
    state.recognition.start();
    setPhase('listening');
  } catch (error) {
    setPhase('idle');
  }
}

function stopListening() {
  if (!state.recognition) return;
  try { state.recognition.abort(); } catch (error) {}
  if (state.phase === 'listening') setPhase('idle');
}

function openSheet(name) {
  const sheet = { growth: growthSheet, device: deviceSheet, settings: settingsSheet }[name];
  if (!sheet) return;
  if (name === 'growth') renderGrowth();
  sheet.showModal();
}

function closeSheet(name) {
  const sheet = { growth: growthSheet, device: deviceSheet, settings: settingsSheet }[name];
  if (sheet?.open) sheet.close();
}

async function pairBluetooth() {
  if (!navigator.bluetooth) {
    bluetoothStatus.textContent = '此浏览器不支持 Web Bluetooth';
    return;
  }
  bluetoothStatus.textContent = '等待选择设备';
  try {
    const device = await navigator.bluetooth.requestDevice({ acceptAllDevices: true });
    bluetoothStatus.textContent = `已配对 ${device.name || '未命名设备'}`;
    bluetoothButton.textContent = '重新配对';
    updateProfile(growSoulmate(state.profile, { kind: 'device' }));
  } catch (error) {
    bluetoothStatus.textContent = error?.name === 'NotFoundError' ? '已取消配对' : '配对失败';
  }
}

async function detectBridge() {
  bridgeStatus.textContent = '正在检测 127.0.0.1:8765';
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 2200);
  try {
    const response = await fetch('http://127.0.0.1:8765/status', { signal: controller.signal });
    if (!response.ok) throw new Error('offline');
    bridgeStatus.textContent = '已连接本机服务';
    bridgeButton.textContent = '已连接';
  } catch (error) {
    bridgeStatus.textContent = '未发现 Soulmate Bridge';
  } finally {
    window.clearTimeout(timer);
  }
}

function exportProfile() {
  const payload = JSON.stringify({ profile: state.profile, history: state.history }, null, 2);
  const url = URL.createObjectURL(new Blob([payload], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `soulmate-${state.profile.name}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

birthNext.addEventListener('click', () => {
  if (!validateBirthStep()) return;
  if (state.birthStep === 3) completeBirth();
  else showBirthStep(state.birthStep + 1);
});

birthBack.addEventListener('click', () => showBirthStep(state.birthStep - 1));
birthForm.addEventListener('submit', (event) => {
  event.preventDefault();
  birthNext.click();
});

$$('[data-choice]').forEach((button) => {
  button.addEventListener('click', () => selectChoice(button.dataset.choice, button.dataset.value));
});

voicePreview.addEventListener('click', async () => {
  voicePreview.disabled = true;
  voicePreview.textContent = '正在准备声音';
  await speakText('你好。我正在等你给我一个名字。', { allowQueue: true });
  voicePreview.disabled = false;
  voicePreview.textContent = '再听一次';
});

companionTouch.addEventListener('click', () => reactToTouch('touch'));
$$('[data-presence-action]').forEach((button) => {
  button.addEventListener('click', () => reactToTouch(button.dataset.presenceAction));
});

composer.addEventListener('submit', (event) => {
  event.preventDefault();
  sendMessage(chatInput.value);
});

micButton.addEventListener('click', startListening);
queuedAudioButton.addEventListener('click', async () => {
  const blob = state.queuedAudio;
  if (blob) await playAudioBlob(blob, false);
});

$$('[data-open-panel]').forEach((button) => {
  button.addEventListener('click', () => openSheet(button.dataset.openPanel));
});
$('#settings-button').addEventListener('click', () => openSheet('settings'));
$$('[data-close-sheet]').forEach((button) => {
  button.addEventListener('click', () => closeSheet(button.dataset.closeSheet));
});

$$('[data-device-tab]').forEach((button) => {
  button.addEventListener('click', () => {
    $$('[data-device-tab]').forEach((item) => item.classList.toggle('active', item === button));
    $$('[data-device-panel]').forEach((panel) => {
      const active = panel.dataset.devicePanel === button.dataset.deviceTab;
      panel.hidden = !active;
      panel.classList.toggle('active', active);
    });
  });
});

bluetoothButton.addEventListener('click', pairBluetooth);
bridgeButton.addEventListener('click', detectBridge);
$('#export-button').addEventListener('click', exportProfile);
$('#reset-button').addEventListener('click', () => {
  if (!window.confirm('这会删除当前伴侣的名字、人格和共同记忆。确定重新诞生吗？')) return;
  localStorage.removeItem(SOULMATE_STORAGE_KEY);
  localStorage.removeItem(SOULMATE_HISTORY_KEY);
  location.reload();
});

$$('.sheet').forEach((sheet) => {
  sheet.addEventListener('click', (event) => {
    const rect = sheet.getBoundingClientRect();
    const outside = event.clientX < rect.left || event.clientX > rect.right
      || event.clientY < rect.top || event.clientY > rect.bottom;
    if (outside) sheet.close();
  });
});

birthDate.value = new Date().toISOString().slice(0, 10);
setupRecognition();
state.profile = loadProfile();
if (state.profile) {
  state.history = loadHistory();
  if (!state.history.length) {
    state.history = [{ role: 'assistant', content: `你回来了。${state.profile.name}一直在等你。` }];
  }
  birthFlow.hidden = true;
  companionView.hidden = false;
  renderMessages();
  renderCompanion();
  setPhase('idle');
} else {
  birthFlow.hidden = false;
  companionView.hidden = true;
  showBirthStep(0);
}

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
