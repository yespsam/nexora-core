import {
  SOULMATE_HISTORY_KEY,
  SOULMATE_STORAGE_KEY,
  createSoulmateExportBundle,
  createSoulmateProfile,
  growSoulmate,
  normalizeSoulmateExportBundle,
  normalizeSoulmateHistory,
  normalizeSoulmateProfile,
  soulmatePromptProfile,
  soulmateStarterCatalog,
  stagesForStarter,
  stageProgress
} from '../shared/soulmate-profile.mjs';
import {
  PENDANT_BLE_SERVICE_UUID,
  PENDANT_BLE_SNAPSHOT_UUID,
  encodePendantBleSnapshot
} from '../shared/pendant-ble.mjs';
import { openPendantSimulatorWriter } from '../shared/pendant-simulator.mjs';
import { Creature3DViewer } from '../shared/creature-3d-viewer.mjs?v=13';
import { creatureActionForPhase } from '../shared/creature-3d-data.mjs?v=5';
import { shouldBlockRecognizedSpeech } from '../shared/voice-turn.mjs?v=1';

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
const birthVisualModel = $('#birth-visual-model');
const birthVisualCaption = $('#birth-visual-caption');
const identityLine = $('#identity-line');
const stageName = $('#stage-name');
const bondLabel = $('#bond-label');
const bondTrackValue = $('#bond-track-value');
const companionTouch = $('#companion-touch');
const companionModel = $('#companion-model');
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
const pendantButton = $('#pendant-button');
const pendantStatus = $('#pendant-status');
const bluetoothButton = $('#bluetooth-button');
const bluetoothStatus = $('#bluetooth-status');
const bridgeButton = $('#bridge-button');
const bridgeStatus = $('#bridge-status');
const voiceSettingStatus = $('#voice-setting-status');
const importButton = $('#import-button');
const importInput = $('#import-input');
const importStatus = $('#import-status');
const pageParams = new URLSearchParams(location.search);
const pendantSimulationMode = pageParams.get('lab') === '1' || pageParams.get('simulator') === '1';

const phaseLabels = {
  idle: '待机',
  affection: '正在靠近你',
  listening: '正在听你说',
  thinking: '正在思考',
  speaking: '正在回答',
  happy: '很开心',
  ready: '点击播放',
  error: '播放失败',
  offline: '语音暂不可用'
};

const voiceNames = {
  soft: '星语',
  bright: '幼灵',
  steady: '锋鸣'
};

const starterVoiceDefaults = Object.freeze({
  cute: 'bright',
  cool: 'steady',
  beautiful: 'soft'
});

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
    starter: 'cute',
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
  recognitionSupported: false,
  recognitionAccepting: false,
  echoGuardUntil: 0,
  currentAudio: null,
  currentAudioUrl: '',
  queuedAudio: null,
  queuedAudioUrl: '',
  lastAssistantText: '',
  lastAssistantAt: 0,
  currentStageId: '',
  pendantDevice: null,
  pendantCharacteristic: null,
  pendantSyncTimer: 0,
  presencePhaseTimer: 0
};

let creatureViewer = null;
let birthViewer = null;
try {
  creatureViewer = new Creature3DViewer(companionModel);
  birthViewer = new Creature3DViewer(birthVisualModel, { frustumHeight: 3.05 });
  birthViewer.load('cute', 'idle', 'seed');
} catch (error) {
  companionModel.dataset.modelState = 'error';
  birthVisualModel.dataset.modelState = 'error';
}

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
  return normalizeSoulmateHistory(safeRead(SOULMATE_HISTORY_KEY));
}

function saveProfile() {
  if (state.profile) safeWrite(SOULMATE_STORAGE_KEY, state.profile);
}

function saveHistory() {
  safeWrite(SOULMATE_HISTORY_KEY, state.history.slice(-12));
}

function personaFromStarter(starter = state.profile?.starter || state.birthSelections.starter) {
  return `creature:${['cute', 'cool', 'beautiful'].includes(starter) ? starter : 'cute'}`;
}

function voiceArchetype(voice = state.profile?.voice || state.birthSelections.voice) {
  if (voice === 'bright') return 'sprout';
  if (voice === 'steady') return 'edge';
  return 'aether';
}

function setPhase(phase) {
  state.phase = phase;
  companionView.dataset.conversationPhase = phase;
  conversationStateLabel.textContent = phaseLabels[phase] || phaseLabels.idle;
  if (state.profile) {
    const stage = stageProgress(state.profile).stage.id;
    creatureViewer?.load(state.profile.starter, creatureActionForPhase[phase] || 'idle', stage);
  }
  const voiceBusy = ['thinking', 'speaking', 'ready'].includes(phase) || state.busy;
  micButton.disabled = !state.recognitionSupported || voiceBusy;
  if (!state.recognitionSupported) {
    micButton.textContent = '不可用';
    micButton.setAttribute('aria-pressed', 'false');
  } else {
    micButton.textContent = phase === 'listening' ? '停止' : '说话';
    micButton.setAttribute('aria-pressed', phase === 'listening' ? 'true' : 'false');
  }
  queuePendantSync();
}

function showBirthStep(index) {
  state.birthStep = Math.max(0, Math.min(4, index));
  $$('.birth-step').forEach((step, stepIndex) => {
    step.hidden = stepIndex !== state.birthStep;
    step.classList.toggle('active', stepIndex === state.birthStep);
  });
  birthStepLabel.textContent = `${String(state.birthStep + 1).padStart(2, '0')} / 05`;
  birthBack.disabled = state.birthStep === 0;
  birthNext.textContent = state.birthStep === 4 ? '让它诞生' : '继续';
  if (state.birthStep === 1) window.setTimeout(() => birthName.focus(), 120);
}

function selectChoice(group, value) {
  state.birthSelections[group] = value;
  $$(`[data-choice="${group}"]`).forEach((button) => {
    button.classList.toggle('active', button.dataset.value === value);
    button.setAttribute('aria-pressed', button.dataset.value === value ? 'true' : 'false');
  });
  if (group === 'starter') {
    const starter = soulmateStarterCatalog[value] || soulmateStarterCatalog.cute;
    state.birthSelections.voice = starterVoiceDefaults[value] || 'soft';
    $$('[data-choice="voice"]').forEach((button) => {
      const active = button.dataset.value === state.birthSelections.voice;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    birthViewer?.load(value, 'idle', 'seed');
    birthVisualCaption.textContent = `${starter.species}正在等你的选择`;
  }
}

function validateBirthStep() {
  if (state.birthStep === 1 && !birthName.value.trim()) {
    birthName.setCustomValidity('请先为它取一个名字');
    birthName.reportValidity();
    birthName.setCustomValidity('');
    return false;
  }
  if (state.birthStep === 2 && !birthDate.value) {
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
  queuePendantSync();
}

function renderCompanion() {
  if (!state.profile) return;
  const progress = stageProgress(state.profile);
  identityLine.textContent = `${state.profile.name} · 第 ${state.profile.daysTogether} 天`;
  stageName.textContent = progress.stage.name;
  bondLabel.textContent = `共鸣 ${state.profile.bond}`;
  bondTrackValue.style.width = `${Math.round(progress.progress * 100)}%`;
  const stageIdentity = `${state.profile.starter}:${progress.stage.id}`;
  if (state.currentStageId !== stageIdentity) {
    state.currentStageId = stageIdentity;
    creatureViewer?.load(
      state.profile.starter,
      creatureActionForPhase[state.phase] || 'idle',
      progress.stage.id
    ).then((loaded) => {
      if (loaded) creatureViewer.preload(state.profile.starter, ['nod', 'speaking'], progress.stage.id);
    });
  }
  $('#setting-voice').textContent = voiceNames[state.profile.voice] || voiceNames.soft;
  $$('[data-setting-voice]').forEach((button) => {
    const active = button.dataset.settingVoice === state.profile.voice;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
  $('#setting-starter').textContent = (soulmateStarterCatalog[state.profile.starter] || soulmateStarterCatalog.cute).species;
  $('#setting-birthday').textContent = state.profile.birthday;
  renderGrowth();
}

function renderGrowth() {
  if (!state.profile) return;
  const progress = stageProgress(state.profile);
  growthTitle.textContent = progress.stage.name;
  evolutionList.textContent = '';
  stagesForStarter(state.profile.starter).forEach((stage) => {
    const item = document.createElement('div');
    const unlocked = state.profile.bond >= stage.minBond;
    item.className = `evolution-item${stage.id === progress.stage.id ? ' active' : ''}${unlocked ? ' unlocked' : ''}`;
    const marker = document.createElement('i');
    marker.textContent = { seed: 'I', young: 'II', resonance: 'III' }[stage.id] || '';
    const title = document.createElement('strong');
    title.textContent = stage.name;
    const status = document.createElement('span');
    status.textContent = unlocked ? (stage.id === progress.stage.id ? '当前形态' : '已经历') : `共鸣 ${stage.minBond} 解锁`;
    item.append(marker, title, status);
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
    line.textContent = memory.summary || memory.text;
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
  if (!state.busy && !['listening', 'thinking', 'speaking', 'ready'].includes(state.phase)) {
    window.clearTimeout(state.presencePhaseTimer);
    setPhase(kind === 'care' ? 'happy' : 'affection');
    state.presencePhaseTimer = window.setTimeout(() => setPhase('idle'), kind === 'care' ? 1350 : 1050);
  }
  window.setTimeout(() => companionTouch.classList.remove('interacting'), 700);
}

function looksLikeEcho(text) {
  return shouldBlockRecognizedSpeech({
    text,
    lastAssistantText: state.lastAssistantText,
    lastAssistantAt: state.lastAssistantAt,
    echoGuardUntil: state.echoGuardUntil
  });
}

function fallbackReply(text) {
  const name = state.profile.name;
  const preference = text.match(/我(?:最|很|比较)?喜欢(.+?)(?:[，。！？]|$)/);
  if (preference?.[1]) return `记住了，你喜欢${preference[1]}。以后聊到它时，我会知道这对你很特别。`;
  if (/累|难过|压力|心烦|害怕|焦虑|委屈/.test(text)) return '我听见了。你不用立刻变好，先让我安静地陪你一会儿。';
  if (/晚安|睡觉|困了|想睡/.test(text)) return `晚安。${name}会把今天记住，明天醒来再继续陪你。`;
  if (/你是谁|你叫(?:什么|啥)|叫什么名字|介绍一下你自己/.test(text)) {
    return `我是${name}，是你在 ${state.profile.birthday} 唤醒的 NEXORA 伙伴。`;
  }
  if (/记住|别忘了/.test(text)) return '我记住了。它已经成为我们共同记忆里的一部分。';
  return '我正在认真记住你刚才说的话。再多告诉我一点，我会越来越懂你。';
}

async function requestReply(text) {
  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text,
      persona: personaFromStarter(),
      persona_short: personaFromStarter(),
      relationship: 'companion',
      scene: 'daily',
      history: state.history.slice(0, -1),
      soulmate: soulmatePromptProfile(state.profile, text)
    })
  });
  if (!response.ok) throw new Error(`chat ${response.status}`);
  const body = await response.json();
  const reply = String(body.text || body.reply || '').replace(/\s+/g, ' ').trim().slice(0, 300);
  if (!reply) throw new Error('empty reply');
  return { reply, mood: body.emotion?.mood || 'calm' };
}

async function sendMessage(rawText, { source = 'text' } = {}) {
  const text = String(rawText || '').replace(/\s+/g, ' ').trim().slice(0, 160);
  if (!text || state.busy || (source === 'voice' && looksLikeEcho(text))) return;
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
  const body = JSON.stringify({
    text,
    persona: personaFromStarter(),
    relationship: 'companion',
    mood,
    archetype: voiceArchetype(),
    starter: state.profile?.starter || state.birthSelections.starter
  });
  let lastError;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch('/api/voice/speak', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body
      });
      const type = response.headers.get('content-type') || '';
      if (response.ok && type.includes('audio')) return response.blob();
      lastError = new Error(`voice ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    if (attempt === 0) await new Promise((resolve) => window.setTimeout(resolve, 320));
  }
  throw lastError || new Error('voice unavailable');
}

function clearQueuedAudio() {
  if (state.queuedAudioUrl) URL.revokeObjectURL(state.queuedAudioUrl);
  state.queuedAudio = null;
  state.queuedAudioUrl = '';
  queuedAudioButton.hidden = true;
}

function stopAudio() {
  const wasGuardingOutput = state.echoGuardUntil === Number.MAX_SAFE_INTEGER;
  if (state.currentAudio) {
    state.currentAudio.pause();
    state.currentAudio.removeAttribute('src');
  }
  if (state.currentAudioUrl) URL.revokeObjectURL(state.currentAudioUrl);
  state.currentAudio = null;
  state.currentAudioUrl = '';
  if (wasGuardingOutput) state.echoGuardUntil = Date.now() + 1000;
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
  state.echoGuardUntil = Number.MAX_SAFE_INTEGER;
  audio.onended = () => {
    state.echoGuardUntil = Date.now() + 1800;
    stopAudio();
    setPhase('idle');
  };
  audio.onerror = () => {
    state.echoGuardUntil = Date.now() + 800;
    stopAudio();
    setPhase('error');
  };
  setPhase('speaking');
  try {
    await audio.play();
  } catch (error) {
    state.echoGuardUntil = Date.now();
    stopAudio();
    if (!allowQueue) {
      setPhase('error');
      return false;
    }
    state.queuedAudio = blob;
    state.queuedAudioUrl = URL.createObjectURL(blob);
    queuedAudioButton.hidden = false;
    setPhase('ready');
  }
  return true;
}

async function speakText(text, { mood = 'happy', allowQueue = false } = {}) {
  stopListening();
  setPhase('thinking');
  try {
    const blob = await fetchVoice(text, mood);
    return await playAudioBlob(blob, allowQueue);
  } catch (error) {
    setPhase('offline');
    return false;
  }
}

function setupRecognition() {
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Recognition) {
    micButton.disabled = true;
    micButton.textContent = '不可用';
    micButton.title = '当前浏览器不支持语音识别，请使用文字输入';
    micButton.setAttribute('aria-label', '当前浏览器不支持语音识别，请使用文字输入');
    return;
  }
  const recognition = new Recognition();
  recognition.lang = 'zh-CN';
  recognition.continuous = false;
  recognition.interimResults = false;
  recognition.onresult = (event) => {
    const text = event.results?.[0]?.[0]?.transcript || '';
    const accepting = state.recognitionAccepting
      && state.phase === 'listening'
      && Date.now() >= state.echoGuardUntil;
    stopListening();
    if (!accepting || looksLikeEcho(text)) {
      presenceLine.textContent = '已阻止语音回声，没有将它当成你的话。';
      return;
    }
    sendMessage(text, { source: 'voice' });
  };
  recognition.onerror = () => {
    state.recognitionAccepting = false;
    if (state.phase === 'listening') setPhase('idle');
  };
  recognition.onend = () => {
    state.recognitionAccepting = false;
    if (state.phase === 'listening') setPhase('idle');
  };
  state.recognition = recognition;
  state.recognitionSupported = true;
  setPhase(state.phase);
}

function startListening() {
  if (!state.recognition || state.busy || ['thinking', 'speaking', 'ready'].includes(state.phase)) return;
  if (Date.now() < state.echoGuardUntil) {
    presenceLine.textContent = '等声音播放结束后，我再认真听你说。';
    return;
  }
  if (state.phase === 'listening') {
    stopListening();
    return;
  }
  stopAudio();
  try {
    state.recognitionAccepting = true;
    state.recognition.start();
    setPhase('listening');
  } catch (error) {
    state.recognitionAccepting = false;
    setPhase('idle');
  }
}

function stopListening() {
  if (!state.recognition) return;
  state.recognitionAccepting = false;
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
  bluetoothStatus.textContent = '等待选择网关';
  try {
    const device = await navigator.bluetooth.requestDevice({ acceptAllDevices: true });
    bluetoothStatus.textContent = `已选择 ${device.name || '未命名设备'} · 待配置协议`;
    bluetoothButton.textContent = '更换';
  } catch (error) {
    bluetoothStatus.textContent = error?.name === 'NotFoundError' ? '已取消选择' : '选择失败';
  }
}

function pendantDisconnected() {
  state.pendantCharacteristic = null;
  pendantStatus.textContent = '连接已断开';
  pendantButton.textContent = '重新连接';
}

async function syncPendant() {
  if (!state.pendantCharacteristic || !state.profile) return false;
  const payload = encodePendantBleSnapshot(state.profile, state.phase);
  if (!payload) return false;
  try {
    if (state.pendantCharacteristic.writeValueWithResponse) {
      await state.pendantCharacteristic.writeValueWithResponse(payload);
    } else {
      await state.pendantCharacteristic.writeValue(payload);
    }
    pendantStatus.textContent = `已同步 ${state.profile.name} · 共鸣 ${state.profile.bond}`;
    return true;
  } catch (error) {
    pendantDisconnected();
    return false;
  }
}

function queuePendantSync() {
  window.clearTimeout(state.pendantSyncTimer);
  if (!state.pendantCharacteristic || !state.profile) return;
  state.pendantSyncTimer = window.setTimeout(syncPendant, 80);
}

async function connectPendant() {
  if (pendantSimulationMode) {
    if (!state.pendantCharacteristic) {
      state.pendantCharacteristic = openPendantSimulatorWriter();
      state.pendantDevice = { name: 'NEXORA NC-01 · 电脑模拟器' };
      pendantButton.textContent = '同步';
    }
    await syncPendant();
    pendantStatus.textContent = `模拟器已同步 ${state.profile.name} · 共鸣 ${state.profile.bond}`;
    return;
  }
  if (!navigator.bluetooth) {
    pendantStatus.textContent = '此浏览器不支持 Web Bluetooth';
    return;
  }
  if (state.pendantCharacteristic) {
    await syncPendant();
    return;
  }
  pendantStatus.textContent = '正在查找 NC-01';
  try {
    const device = await navigator.bluetooth.requestDevice({
      filters: [{ services: [PENDANT_BLE_SERVICE_UUID] }]
    });
    device.addEventListener('gattserverdisconnected', pendantDisconnected);
    const server = await device.gatt.connect();
    const service = await server.getPrimaryService(PENDANT_BLE_SERVICE_UUID);
    state.pendantCharacteristic = await service.getCharacteristic(PENDANT_BLE_SNAPSHOT_UUID);
    state.pendantDevice = device;
    pendantButton.textContent = '同步';
    pendantStatus.textContent = `已连接 ${device.name || 'NC-01'}`;
    await syncPendant();
  } catch (error) {
    pendantStatus.textContent = error?.name === 'NotFoundError' ? '已取消连接' : '连接失败，请让项链保持开机';
    pendantButton.textContent = '重试';
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
    bridgeStatus.textContent = '未发现 NEXORA Bridge';
  } finally {
    window.clearTimeout(timer);
  }
}

function exportProfile() {
  const bundle = createSoulmateExportBundle(state.profile, state.history);
  if (!bundle) return;
  const payload = JSON.stringify(bundle, null, 2);
  const url = URL.createObjectURL(new Blob([payload], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `nexora-core-${state.profile.name}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

async function importProfile(file) {
  importStatus.textContent = '';
  if (!file || file.size > 1024 * 1024) {
    importStatus.textContent = '请选择小于 1 MB 的 NEXORA 数据文件。';
    return;
  }
  try {
    const raw = JSON.parse(await file.text());
    const bundle = normalizeSoulmateExportBundle(raw);
    if (!bundle) throw new Error('invalid bundle');
    if (!window.confirm(`导入「${bundle.profile.name}」会替换当前伴侣和对话记录。确定继续吗？`)) return;
    state.profile = bundle.profile;
    state.history = bundle.history.length ? bundle.history : [{
      role: 'assistant',
      content: `你回来了。${bundle.profile.name}还记得你。`
    }];
    saveProfile();
    saveHistory();
    renderMessages();
    renderCompanion();
    presenceLine.textContent = `${state.profile.name}的数据已恢复。`;
    importStatus.textContent = '导入完成';
  } catch (error) {
    importStatus.textContent = '无法读取这个文件，请确认它由 NEXORA CORE 导出。';
  }
}

birthNext.addEventListener('click', () => {
  if (!validateBirthStep()) return;
  if (state.birthStep === 4) completeBirth();
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
  const played = await speakText('你好。我正在等你给我一个名字。', { allowQueue: true });
  voicePreview.disabled = false;
  voicePreview.textContent = played ? '试听成功，再听一次' : '声音暂不可用，重试';
});

$$('[data-setting-voice]').forEach((button) => {
  button.addEventListener('click', async () => {
    if (!state.profile) return;
    stopAudio();
    state.profile = { ...state.profile, voice: button.dataset.settingVoice };
    saveProfile();
    renderCompanion();
    voiceSettingStatus.textContent = `正在试听${voiceNames[state.profile.voice]}声线`;
    const played = await speakText(`你好，我是${state.profile.name}。这是我现在的声音。`, { allowQueue: true });
    voiceSettingStatus.textContent = played ? '声线已保存' : '声线已保存，云端语音暂不可用';
  });
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
pendantButton.addEventListener('click', connectPendant);
bridgeButton.addEventListener('click', detectBridge);
$('#export-button').addEventListener('click', exportProfile);
importButton.addEventListener('click', () => importInput.click());
importInput.addEventListener('change', async () => {
  await importProfile(importInput.files?.[0]);
  importInput.value = '';
});
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

if (pendantSimulationMode) {
  pendantStatus.textContent = '电脑模拟设备待连接';
  pendantButton.textContent = '连接模拟器';
  Object.defineProperty(window, '__NEXORA_LAB__', {
    configurable: true,
    value: Object.freeze({
      connectPendant,
      sendMessage,
      setPhase,
      getState: () => ({
        phase: state.phase,
        busy: state.busy,
        profile: state.profile ? structuredClone(state.profile) : null,
        history: structuredClone(state.history),
        pendantConnected: Boolean(state.pendantCharacteristic)
      }),
      sampleModel: () => creatureViewer?.samplePixels() || null,
      sampleBirthModel: () => birthViewer?.samplePixels() || null,
      getModelState: () => creatureViewer?.getState() || null
    })
  });
  window.dispatchEvent(new CustomEvent('nexora:lab-ready'));
}

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
