import {
  SOULMATE_HISTORY_KEY,
  SOULMATE_STORAGE_KEY,
  createSoulmateExportBundle,
  createSoulmateProfile,
  defaultVoiceForStarter,
  growSoulmate,
  normalizeSoulmateExportBundle,
  normalizeSoulmateHistory,
  normalizeSoulmateProfile,
  soulmatePromptProfile,
  soulmateStarterCatalog,
  stagesForStarter,
  stageProgress
} from '../shared/soulmate-profile.mjs?v=2';
import {
  PENDANT_BLE_SERVICE_UUID,
  PENDANT_BLE_SNAPSHOT_UUID,
  encodePendantBleSnapshot
} from '../shared/pendant-ble.mjs';
import { openPendantSimulatorWriter } from '../shared/pendant-simulator.mjs';
import {
  SOULMATE_SYNC_STORAGE_KEY,
  openSoulmateSync
} from '../shared/soulmate-sync.mjs?v=3';
import {
  clearSoulmateCloudDeviceState,
  createSoulmateCloudIdentity,
  deleteSoulmateCloudState,
  downloadSoulmateCloudState,
  formatSoulmateRecoveryCode,
  loadSoulmateCloudDeviceState,
  mergeSoulmateSyncBundles,
  parseSoulmateRecoveryCode,
  saveSoulmateCloudDeviceState,
  uploadSoulmateCloudState
} from '../shared/soulmate-cloud-sync.mjs?v=4';
import {
  clearSoulmateDeviceCloudState,
  getSoulmateDeviceCloudDiagnostic,
  mirrorSoulmateCloudState,
  requestSoulmateDeviceCloudDeletion
} from '../shared/soulmate-device-cloud.mjs?v=2';
import { Creature3DViewer } from '../shared/creature-3d-viewer.mjs?v=27';
import {
  creatureActionForPhase,
  creatureActionForResponse
} from '../shared/creature-3d-data.mjs?v=16';
import {
  recognitionFailureMessage,
  recognitionTranscript,
  parseVoiceControlCommand,
  shouldBlockRecognizedSpeech,
  VOICE_LISTEN_TIMEOUT_MS,
  VOICE_WAKE_COMMAND_WINDOW_MS,
  voiceWakeWords,
  voiceControlState
} from '../shared/voice-turn.mjs?v=4';
import {
  canResumeSoulmateCloudSync,
  isPrivateAccessExpired,
  privateAccessLoginPath,
  soulmateCloudRetryDelay
} from '../shared/soulmate-resilience.mjs?v=2';
import {
  appendChatStreamDelta,
  parseChatStreamEvent
} from '../shared/chat-stream.mjs?v=1';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const birthFlow = $('#birth-flow');
const companionView = $('#companion-view');
const startupStatus = $('#startup-status');
const birthForm = $('#birth-form');
const birthName = $('#birth-name');
const birthDate = $('#birth-date');
const birthStepLabel = $('#birth-step-label');
const birthBack = $('#birth-back');
const birthNext = $('#birth-next');
const voicePreview = $('#voice-preview');
const birthVisualModel = $('#birth-visual-model');
const birthVisualCaption = $('#birth-visual-caption');
const birthRestoreOpen = $('#birth-restore-open');
const birthRestorePanel = $('#birth-restore-panel');
const birthRestoreInput = $('#birth-restore-input');
const birthRestoreSubmit = $('#birth-restore-submit');
const birthRestoreStatus = $('#birth-restore-status');
const identityLine = $('#identity-line');
const stageName = $('#stage-name');
const bondLabel = $('#bond-label');
const bondTrackValue = $('#bond-track-value');
const companionTouch = $('#companion-touch');
const companionModel = $('#companion-model');
const actionDock = $('#action-dock');
const presenceLine = $('#presence-line');
const conversationStateLabel = $('#conversation-state-label');
const messageList = $('#message-list');
const composer = $('#composer');
const chatInput = $('#chat-input');
const micButton = $('#mic-button');
const wakeButton = $('#wake-button');
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
const llmProviderLabel = $('#llm-provider-label');
const llmApiStatus = $('#llm-api-status');
const importButton = $('#import-button');
const importInput = $('#import-input');
const importStatus = $('#import-status');
const privateAccessStatus = $('#private-access-status');
const cloudSyncState = $('#cloud-sync-state');
const cloudSyncEnable = $('#cloud-sync-enable');
const cloudSyncNow = $('#cloud-sync-now');
const cloudSyncShowCode = $('#cloud-sync-show-code');
const cloudSyncCode = $('#cloud-sync-code');
const cloudSyncRestoreInput = $('#cloud-sync-restore-input');
const cloudSyncRestore = $('#cloud-sync-restore');
const cloudSyncStop = $('#cloud-sync-stop');
const cloudSyncDelete = $('#cloud-sync-delete');
const cloudSyncDiagnostic = $('#cloud-sync-diagnostic');
const cloudSyncStatus = $('#cloud-sync-status');
const pageParams = new URLSearchParams(location.search);
const resetRequested = pageParams.get('reset') === '1';
const pendantSimulationMode = pageParams.get('lab') === '1' || pageParams.get('simulator') === '1';
const APP_RELEASE = 'streaming-dialogue-v91';
const llmFailureMessages = Object.freeze({
  authentication_required: '登录已过期，正在重新验证身份。',
  server_key_auth: '云端 Kimi 凭据无效，请联系管理员更新。',
  server_key_quota: '云端 Kimi 额度不足，请联系管理员处理。',
  server_key_rate_limit: '云端请求较多，请稍后再试。',
  server_key_model: '云端模型暂不可用，请联系管理员处理。',
  server_key_request: 'Kimi 暂时不接受当前请求。',
  server_key_provider: 'Kimi 服务暂时不可用，请稍后重试。',
  server_key_timeout: 'Kimi 响应超时，请重试。',
  server_key_network: '私有云暂时无法连接 Kimi。',
  server_key_invalid_response: 'Kimi 返回了无法解析的回答。',
  server_key_failed: 'Kimi 没有完成这次请求。',
  gateway_failed: '云端模型网关暂时不可用，请稍后重试。',
  not_configured: '私有云尚未配置对话模型。',
  request_failed: '消息没有送到云端，请刷新页面后重试。'
});

const phaseLabels = {
  idle: '待机',
  acting: '正在互动',
  affection: '正在靠近你',
  listening: '正在听你说',
  thinking: '正在思考',
  speaking: '正在回答',
  happy: '很开心',
  ready: '点击播放',
  error: '播放失败',
  offline: '语音暂不可用'
};

const companionActions = Object.freeze({
  wave: Object.freeze({ label: '正在向你招手', line: '它抬起手向你打招呼。', duration: 2600 }),
  nod: Object.freeze({ label: '正在点头', line: '它认真地点了点头。', duration: 2200 }),
  affection: Object.freeze({ label: '正在靠近你', line: '它轻轻靠近了你。', duration: 2800 }),
  walk: Object.freeze({ label: '正在行走', line: '它在你面前走了起来。', duration: 2600 }),
  run: Object.freeze({ label: '正在奔跑', line: '它轻快地跑了起来。', duration: 2400 }),
  idle: Object.freeze({ label: '待机', line: '它停下来，重新看向你。', duration: 0 })
});

const WAKE_RESTART_DELAY_MS = 650;

const voiceNames = {
  soft: '星语',
  bright: '幼灵',
  steady: '锋鸣'
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
    starter: 'cute',
    gender: 'neutral',
    temperament: 'warm',
    voice: defaultVoiceForStarter('cute'),
    voiceCustomized: false
  },
  profile: null,
  history: [],
  streamingReply: '',
  phase: 'idle',
  activeAction: '',
  actionLabel: '',
  busy: false,
  touchRewards: 0,
  careRewards: 0,
  recognition: null,
  recognitionSupported: false,
  recognitionAccepting: false,
  recognitionResultReceived: false,
  recognitionMode: '',
  listeningTimer: 0,
  recognitionTimeout: 0,
  wakeEnabled: false,
  wakeRestartTimer: 0,
  wakeCommandUntil: 0,
  echoGuardUntil: 0,
  voiceRequestController: null,
  voiceRequestId: 0,
  playbackId: 0,
  audioContext: null,
  currentAudioSource: null,
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
  presencePhaseTimer: 0,
  continuity: null,
  cloudIdentity: null,
  cloudRevision: 0,
  cloudSyncTimer: 0,
  cloudRetryTimer: 0,
  cloudRetryAttempt: 0,
  cloudWaitingForOnline: false,
  cloudChangeVersion: 0,
  cloudSyncedVersion: 0,
  cloudBusy: false,
  cloudReady: false,
  cloudAvailable: true,
  cloudRecoveryBlocked: false,
  cloudDiagnostic: null
};

let creatureViewer = null;
let birthViewer = null;
try {
  creatureViewer = new Creature3DViewer(companionModel, { frustumHeight: 2.78 });
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

function redirectToPrivateAccess() {
  if (location.pathname.startsWith('/access')) return;
  location.replace(privateAccessLoginPath(location));
}

function renderLlmConnection({
  mode = '',
  provider = '',
  failure = '',
  available = false,
  latency = null
} = {}) {
  if (mode === 'cloud_llm' || available) {
    const labels = {
      kimi: 'Kimi 私有云',
      netlify_ai_gateway: 'Netlify AI 已连接'
    };
    const label = labels[provider] || '云端模型已配置';
    llmProviderLabel.textContent = label;
    const firstTokenMs = Math.max(0, Number(latency?.first_token_ms) || 0);
    const totalMs = Math.max(firstTokenMs, Number(latency?.total_ms) || 0);
    const timing = firstTokenMs
      ? ` 本次首字 ${(firstTokenMs / 1000).toFixed(1)} 秒，完整 ${(totalMs / 1000).toFixed(1)} 秒。`
      : '';
    llmApiStatus.textContent = mode === 'cloud_llm'
      ? `真实模型正在结合前文与长期记忆回答。${timing}`
      : '服务器凭据已就绪，设备端无需填写 API Key。';
    llmApiStatus.dataset.firstTokenMs = firstTokenMs ? String(Math.round(firstTokenMs)) : '';
    llmApiStatus.dataset.totalMs = totalMs ? String(Math.round(totalMs)) : '';
    return;
  }
  if (failure && failure !== 'not_configured') {
    llmProviderLabel.textContent = '云端模型异常';
    llmApiStatus.textContent = llmFailureMessages[failure] || '请稍后重试或联系管理员。';
    return;
  }
  llmProviderLabel.textContent = mode === 'checking' ? '正在检查' : '尚未配置';
  llmApiStatus.textContent = mode === 'checking'
    ? '正在读取私有云模型状态。'
    : llmFailureMessages.not_configured;
}

async function refreshLlmConnection() {
  renderLlmConnection({ mode: 'checking' });
  try {
    const response = await fetch('/api/chat', {
      headers: { Accept: 'application/json' },
      credentials: 'same-origin',
      cache: 'no-store'
    });
    const status = await response.json().catch(() => ({}));
    if (isPrivateAccessExpired(response.status, status.error)) {
      renderLlmConnection({ failure: 'authentication_required' });
      redirectToPrivateAccess();
      return;
    }
    if (!response.ok) {
      renderLlmConnection({ failure: 'request_failed' });
      return;
    }
    renderLlmConnection({
      available: status.enabled === true,
      provider: String(status.default_provider || ''),
      failure: status.enabled ? '' : 'not_configured'
    });
  } catch (error) {
    renderLlmConnection({ failure: 'request_failed' });
  }
}

function cleanMessage(value) {
  const role = value?.role === 'assistant' ? 'assistant' : value?.role === 'user' ? 'user' : '';
  const content = String(value?.content || '').replace(/\s+/g, ' ').trim().slice(0, 300);
  if (!role || !content) return null;
  let id = String(value?.id || '').trim();
  if (!/^[a-zA-Z0-9_-]{8,64}$/.test(id)) {
    id = globalThis.crypto?.randomUUID?.()
      || `msg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
  const createdAt = Number.isFinite(Number(value?.createdAt))
    ? Math.max(1, Math.floor(Number(value.createdAt)))
    : Date.now();
  return { role, content, id, createdAt };
}

function loadProfile() {
  if (resetRequested) {
    localStorage.removeItem(SOULMATE_STORAGE_KEY);
    localStorage.removeItem(SOULMATE_HISTORY_KEY);
    localStorage.removeItem(SOULMATE_SYNC_STORAGE_KEY);
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
  state.continuity?.publish(state.profile, state.history);
  queueCloudSync();
}

function saveHistory() {
  safeWrite(SOULMATE_HISTORY_KEY, state.history.slice(-12));
  state.continuity?.publish(state.profile, state.history);
  queueCloudSync();
}

function personaFromStarter(starter = state.profile?.starter || state.birthSelections.starter) {
  return `creature:${['cute', 'cool', 'beautiful'].includes(starter) ? starter : 'cute'}`;
}

function voiceArchetype(voice = state.profile?.voice || state.birthSelections.voice) {
  if (voice === 'bright') return 'sprout';
  if (voice === 'steady') return 'edge';
  return 'aether';
}

function setPhase(phase, responseAction = '') {
  if (phase !== 'acting') {
    state.activeAction = '';
    state.actionLabel = '';
    $$('[data-companion-action]').forEach((button) => button.classList.remove('active'));
  }
  state.phase = phase;
  companionView.dataset.conversationPhase = phase;
  conversationStateLabel.textContent = phase === 'acting' && state.actionLabel
    ? state.actionLabel
    : phaseLabels[phase] || phaseLabels.idle;
  if (state.profile) {
    const stage = stageProgress(state.profile).stage.id;
    const action = phase === 'acting' && state.activeAction
      ? state.activeAction
      : phase === 'thinking' && creatureActionForResponse[responseAction]
        ? creatureActionForResponse[responseAction]
        : creatureActionForPhase[phase] || 'idle';
    creatureViewer?.load(state.profile.starter, action, stage);
  }
  const voiceControl = voiceControlState({
    recognitionSupported: state.recognitionSupported,
    phase,
    busy: state.busy,
    hasVoiceOutput: Boolean(
      state.voiceRequestController
      || state.currentAudioSource
      || state.currentAudio
      || state.queuedAudio
    )
  });
  micButton.disabled = voiceControl.disabled;
  micButton.textContent = voiceControl.label;
  micButton.setAttribute('aria-label', voiceControl.ariaLabel);
  micButton.setAttribute('aria-pressed', voiceControl.pressed ? 'true' : 'false');
  renderWakeButton();
  if (phase === 'idle') scheduleWakeRecognition();
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
  if (group === 'voice') state.birthSelections.voiceCustomized = true;
  $$(`[data-choice="${group}"]`).forEach((button) => {
    button.classList.toggle('active', button.dataset.value === value);
    button.setAttribute('aria-pressed', button.dataset.value === value ? 'true' : 'false');
  });
  if (group === 'starter') {
    const starter = soulmateStarterCatalog[value] || soulmateStarterCatalog.cute;
    state.birthSelections.voice = defaultVoiceForStarter(value);
    state.birthSelections.voiceCustomized = false;
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
  state.history = [cleanMessage({
    role: 'assistant',
    content: `我醒了。我会记住今天，也会记住你给我的名字——${state.profile.name}。`
  })];
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
  if (state.streamingReply) {
    const paragraph = document.createElement('p');
    paragraph.className = 'message assistant streaming';
    paragraph.textContent = state.streamingReply;
    messageList.appendChild(paragraph);
  }
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
      state.phase === 'acting' && state.activeAction
        ? state.activeAction
        : creatureActionForPhase[state.phase] || 'idle',
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

function setActionDockOpen(open) {
  const next = Boolean(open);
  actionDock.hidden = !next;
  companionTouch.setAttribute('aria-expanded', next ? 'true' : 'false');
  companionTouch.setAttribute('aria-label', next ? '收起伙伴动作' : '打开伙伴动作');
}

function runCompanionAction(action, { source = 'touch' } = {}) {
  const definition = companionActions[action];
  if (!definition || !state.profile) return false;
  if (state.busy || ['listening', 'thinking', 'speaking', 'ready'].includes(state.phase)) {
    presenceLine.textContent = '它正在听你或回答，稍后再试一次。';
    return false;
  }
  window.clearTimeout(state.presencePhaseTimer);
  if (action === 'idle') {
    presenceLine.textContent = definition.line;
    setPhase('idle');
    return true;
  }
  state.activeAction = action;
  state.actionLabel = definition.label;
  setPhase('acting');
  $$('[data-companion-action]').forEach((button) => {
    button.classList.toggle('active', button.dataset.companionAction === action);
  });
  presenceLine.textContent = source === 'voice'
    ? `听见了。${definition.line}`
    : definition.line;
  state.presencePhaseTimer = window.setTimeout(() => setPhase('idle'), definition.duration);
  return true;
}

function applyContinuityState(bundle) {
  if (!bundle?.profile) return;
  const merged = mergeSoulmateSyncBundles(currentCloudBundle(), bundle) || bundle;
  state.profile = merged.profile;
  state.history = merged.history;
  safeWrite(SOULMATE_STORAGE_KEY, state.profile);
  safeWrite(SOULMATE_HISTORY_KEY, state.history);
  startupStatus.hidden = true;
  birthFlow.hidden = true;
  companionView.hidden = false;
  renderMessages();
  renderCompanion();
  queuePendantSync();
  queueCloudSync();
  if (!state.busy && !['listening', 'thinking', 'speaking', 'ready'].includes(state.phase)) {
    presenceLine.textContent = `${state.profile.name}已在当前设备继续陪伴。`;
  }
}

function renderCloudSync() {
  const active = Boolean(state.cloudIdentity);
  cloudSyncState.textContent = active ? `已连接 · v${state.cloudRevision}` : '未开启';
  const diagnostic = state.cloudDiagnostic;
  let diagnosticText = '';
  if (active && diagnostic) {
    if (diagnostic.pending) {
      diagnosticText = `事件镜像待重试 · v${diagnostic.mirroredRevision}`;
    } else if (diagnostic.verifiedRevision > 0) {
      diagnosticText = `事件镜像已验证 · v${diagnostic.verifiedRevision} · 游标 ${diagnostic.cursor}`;
    } else if (diagnostic.registered) {
      diagnosticText = '事件镜像等待验证';
    } else {
      diagnosticText = '事件镜像等待首次同步';
    }
  }
  cloudSyncDiagnostic.textContent = diagnosticText;
  cloudSyncDiagnostic.hidden = !diagnosticText;
  cloudSyncEnable.hidden = active;
  cloudSyncNow.hidden = !active;
  cloudSyncShowCode.hidden = !active;
  cloudSyncStop.hidden = !active;
  cloudSyncDelete.hidden = !active;
  cloudSyncEnable.disabled = state.cloudBusy || !state.cloudAvailable;
  cloudSyncNow.disabled = state.cloudBusy;
  cloudSyncShowCode.disabled = state.cloudBusy;
  cloudSyncRestore.disabled = state.cloudBusy || !state.cloudAvailable;
  cloudSyncStop.disabled = state.cloudBusy;
  cloudSyncDelete.disabled = state.cloudBusy;
  birthRestoreSubmit.disabled = state.cloudBusy || !state.cloudAvailable;
  if (!active) {
    cloudSyncCode.hidden = true;
    cloudSyncCode.textContent = '';
  }
}

function setCloudSyncMessage(message) {
  cloudSyncStatus.textContent = message;
}

function currentCloudBundle() {
  return createSoulmateExportBundle(state.profile, state.history);
}

async function persistCloudDeviceState() {
  if (!state.cloudIdentity) return;
  await saveSoulmateCloudDeviceState(state.cloudIdentity, state.cloudRevision);
}

function applyCloudBundle(bundle, message = '') {
  if (!bundle?.profile) return;
  state.profile = bundle.profile;
  state.history = bundle.history;
  safeWrite(SOULMATE_STORAGE_KEY, state.profile);
  safeWrite(SOULMATE_HISTORY_KEY, state.history);
  startupStatus.hidden = true;
  birthFlow.hidden = true;
  companionView.hidden = false;
  renderMessages();
  renderCompanion();
  state.continuity?.publish(state.profile, state.history);
  queuePendantSync();
  if (message) presenceLine.textContent = message;
}

async function pushCloudState({ manual = false } = {}) {
  if (!state.cloudReady || !state.cloudIdentity || !state.profile || state.cloudBusy) return false;
  const localBundle = currentCloudBundle();
  if (!localBundle) return false;
  const targetVersion = state.cloudChangeVersion;
  state.cloudBusy = true;
  renderCloudSync();
  if (manual) setCloudSyncMessage('正在加密并同步');
  try {
    let result;
    try {
      result = await uploadSoulmateCloudState(localBundle, state.cloudIdentity, state.cloudRevision);
    } catch (error) {
      if (error.status !== 409) throw error;
      if (!error.revision) {
        state.cloudRevision = 0;
        result = await uploadSoulmateCloudState(localBundle, state.cloudIdentity, 0);
      } else {
        const remote = await downloadSoulmateCloudState(state.cloudIdentity);
        const merged = mergeSoulmateSyncBundles(localBundle, remote.bundle);
        applyCloudBundle(merged);
        result = await uploadSoulmateCloudState(merged, state.cloudIdentity, remote.revision);
      }
    }
    state.cloudRevision = result.revision;
    state.cloudSyncedVersion = Math.max(state.cloudSyncedVersion, targetVersion);
    state.cloudRetryAttempt = 0;
    state.cloudWaitingForOnline = false;
    window.clearTimeout(state.cloudRetryTimer);
    state.cloudRetryTimer = 0;
    await persistCloudDeviceState();
    const mirror = await mirrorSoulmateCloudState(
      currentCloudBundle(),
      state.cloudIdentity,
      state.cloudRevision
    );
    state.cloudDiagnostic = await getSoulmateDeviceCloudDiagnostic(state.cloudIdentity);
    if (mirror.enabled && (!mirror.mirrored || !mirror.verified) && mirror.reason !== 'current') {
      console.warn('[device-cloud-dual-write]', {
        mirrored: mirror.mirrored === true,
        verified: mirror.verified === true,
        reason: String(mirror.reason || 'verification_failed').slice(0, 40),
        revision: state.cloudRevision
      });
    }
    setCloudSyncMessage(`已端到端加密同步 · ${new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`);
    return true;
  } catch (error) {
    scheduleCloudRetry();
    return false;
  } finally {
    state.cloudBusy = false;
    renderCloudSync();
    if (
      state.cloudChangeVersion > state.cloudSyncedVersion
      && !state.cloudRetryTimer
      && !state.cloudWaitingForOnline
    ) {
      scheduleCloudSync(0);
    }
  }
}

function scheduleCloudSync(delay = 1400) {
  window.clearTimeout(state.cloudSyncTimer);
  if (!state.cloudReady || !state.cloudIdentity || !state.profile) return;
  state.cloudSyncTimer = window.setTimeout(() => {
    state.cloudSyncTimer = 0;
    void pushCloudState();
  }, Math.max(0, Number(delay) || 0));
}

function scheduleCloudRetry() {
  window.clearTimeout(state.cloudRetryTimer);
  state.cloudRetryTimer = 0;
  if (!state.cloudReady || !state.cloudIdentity || !state.profile) return;
  if (navigator.onLine === false) {
    state.cloudWaitingForOnline = true;
    setCloudSyncMessage('网络已断开，本地数据会在联网后自动同步');
    return;
  }
  state.cloudWaitingForOnline = false;
  const delay = soulmateCloudRetryDelay(state.cloudRetryAttempt);
  state.cloudRetryAttempt += 1;
  setCloudSyncMessage(`同步暂时不可用，本地数据已保留，${Math.ceil(delay / 1000)} 秒后重试`);
  state.cloudRetryTimer = window.setTimeout(() => {
    state.cloudRetryTimer = 0;
    void pushCloudState();
  }, delay);
}

function queueCloudSync() {
  state.cloudChangeVersion += 1;
  window.clearTimeout(state.cloudRetryTimer);
  state.cloudRetryTimer = 0;
  scheduleCloudSync();
}

function resumeCloudSync(message = '') {
  const dirty = state.cloudChangeVersion > state.cloudSyncedVersion;
  if (!canResumeSoulmateCloudSync({
    ready: state.cloudReady,
    identity: state.cloudIdentity,
    profile: state.profile,
    busy: state.cloudBusy,
    dirty,
    online: navigator.onLine !== false
  })) return false;
  window.clearTimeout(state.cloudRetryTimer);
  state.cloudRetryTimer = 0;
  state.cloudRetryAttempt = 0;
  state.cloudWaitingForOnline = false;
  if (message) setCloudSyncMessage(message);
  void pushCloudState();
  return true;
}

async function initializeCloudSync() {
  try {
    const saved = await loadSoulmateCloudDeviceState();
    state.cloudIdentity = saved?.identity || null;
    state.cloudRevision = saved?.revision || 0;
    if (resetRequested && state.cloudIdentity) {
      await clearSoulmateDeviceCloudState(state.cloudIdentity);
      await clearSoulmateCloudDeviceState();
      state.cloudIdentity = null;
      state.cloudRevision = 0;
    } else if (state.cloudIdentity && !state.profile) {
      try {
        setCloudSyncMessage('正在恢复这台设备上的伙伴');
        const remote = await downloadSoulmateCloudState(state.cloudIdentity);
        state.cloudRevision = remote.revision;
        await persistCloudDeviceState();
        applyCloudBundle(remote.bundle, `${remote.bundle.profile.name}已从加密云端恢复。`);
        setCloudSyncMessage('伙伴身份和共同记忆已恢复');
      } catch (error) {
        if (error.status === 404) {
          await clearSoulmateDeviceCloudState(state.cloudIdentity);
          await clearSoulmateCloudDeviceState();
          state.cloudIdentity = null;
          state.cloudRevision = 0;
        } else {
          state.cloudRecoveryBlocked = true;
          setCloudSyncMessage('已找到本机恢复凭证，但云端暂时无法连接');
        }
      }
    }
    state.cloudDiagnostic = state.cloudIdentity
      ? await getSoulmateDeviceCloudDiagnostic(state.cloudIdentity)
      : null;
  } catch (error) {
    state.cloudAvailable = false;
    setCloudSyncMessage('当前浏览器不支持安全设备存储');
  } finally {
    state.cloudReady = true;
    renderCloudSync();
    queueCloudSync();
  }
}

async function enableCloudSync() {
  if (!state.profile || state.cloudBusy) return;
  state.cloudIdentity = createSoulmateCloudIdentity();
  state.cloudRevision = 0;
  state.cloudDiagnostic = null;
  cloudSyncCode.textContent = state.cloudIdentity.recoveryCode;
  cloudSyncCode.hidden = false;
  try {
    await persistCloudDeviceState();
  } catch (error) {
    state.cloudIdentity = null;
    state.cloudAvailable = false;
    renderCloudSync();
    setCloudSyncMessage('当前浏览器无法安全保存恢复凭证');
    return;
  }
  renderCloudSync();
  setCloudSyncMessage('请立即保存恢复码。服务器无法替你找回它。');
  await pushCloudState({ manual: true });
}

async function restoreCloudSyncFrom(input, setMessage) {
  const identity = parseSoulmateRecoveryCode(input.value);
  if (!identity) {
    setMessage('恢复码格式不正确');
    return;
  }
  state.cloudBusy = true;
  renderCloudSync();
  setMessage('正在解密伙伴数据');
  try {
    const remote = await downloadSoulmateCloudState(identity);
    if (state.profile && !window.confirm(`从云端恢复会将当前伴侣替换为「${remote.bundle.profile.name}」。确定继续吗？`)) {
      setMessage('已取消恢复');
      return;
    }
    await saveSoulmateCloudDeviceState(identity, remote.revision);
    state.cloudIdentity = identity;
    state.cloudRevision = remote.revision;
    state.cloudDiagnostic = null;
    applyCloudBundle(remote.bundle, `${remote.bundle.profile.name}已在这台设备醒来。`);
    input.value = '';
    setMessage('恢复成功，之后会自动加密同步');
  } catch (error) {
    setMessage(error.status === 404 ? '没有找到对应的云端伙伴' : '恢复失败，请检查恢复码或网络');
  } finally {
    state.cloudBusy = false;
    renderCloudSync();
  }
}

async function restoreCloudSync() {
  await restoreCloudSyncFrom(cloudSyncRestoreInput, setCloudSyncMessage);
}

async function restoreCloudSyncAtBirth() {
  await restoreCloudSyncFrom(birthRestoreInput, (message) => {
    birthRestoreStatus.textContent = message;
  });
}

async function stopCloudSync() {
  window.clearTimeout(state.cloudSyncTimer);
  try {
    await clearSoulmateDeviceCloudState(state.cloudIdentity);
    await clearSoulmateCloudDeviceState();
    state.cloudIdentity = null;
    state.cloudRevision = 0;
    state.cloudDiagnostic = null;
    renderCloudSync();
    setCloudSyncMessage('已停止本机同步，云端加密副本仍保留');
  } catch (error) {
    setCloudSyncMessage('无法更新本机安全存储，请稍后重试');
  }
}

async function removeCloudSync() {
  if (!state.cloudIdentity || !window.confirm('这会永久删除云端加密副本，其他设备将无法再恢复。确定删除吗？')) return;
  state.cloudBusy = true;
  renderCloudSync();
  try {
    await deleteSoulmateCloudState(state.cloudIdentity);
    const deviceCloudDeletion = await requestSoulmateDeviceCloudDeletion(state.cloudIdentity);
    if (deviceCloudDeletion.enabled && !deviceCloudDeletion.scheduled) {
      throw new Error('device cloud deletion unavailable');
    }
    await clearSoulmateDeviceCloudState(state.cloudIdentity);
    await clearSoulmateCloudDeviceState();
    state.cloudIdentity = null;
    state.cloudRevision = 0;
    state.cloudDiagnostic = null;
    cloudSyncCode.hidden = true;
    setCloudSyncMessage('云端加密副本已删除，本机伙伴仍保留');
  } catch (error) {
    setCloudSyncMessage('删除失败，请稍后重试');
  } finally {
    state.cloudBusy = false;
    renderCloudSync();
  }
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

function showConversationError(failure = 'request_failed') {
  renderMessages();
  const message = document.createElement('p');
  message.className = 'message assistant error';
  message.textContent = `真实对话暂不可用：${llmFailureMessages[failure] || '请稍后重试或联系管理员。'}`;
  messageList.appendChild(message);
}

function replyResultFromBody(response, body) {
  if (isPrivateAccessExpired(response.status, body?.error)) {
    return {
      reply: '',
      mood: 'calm',
      mode: 'authentication_required',
      provider: '',
      failure: 'authentication_required',
      reauthenticate: true
    };
  }
  if (!response.ok || !body) {
    return {
      reply: '',
      mood: 'calm',
      mode: String(body?.mode || 'provider_error'),
      provider: String(body?.llm?.provider || ''),
      failure: String(body?.llm?.failure || 'request_failed')
    };
  }
  if (body.mode !== 'cloud_llm') {
    return {
      reply: '',
      mood: 'calm',
      mode: String(body.mode || ''),
      provider: String(body.llm?.provider || ''),
      failure: String(body.llm?.failure || 'request_failed')
    };
  }
  const reply = String(body.text || body.reply || '').replace(/\s+/g, ' ').trim().slice(0, 300);
  if (!reply) {
    return {
      reply: '',
      mood: 'calm',
      mode: String(body.mode || ''),
      provider: String(body.llm?.provider || ''),
      failure: String(body.llm?.failure || 'request_failed')
    };
  }
  return {
    reply,
    mood: body.emotion?.mood || 'calm',
    action: String(body.actions?.find((item) => item?.target === 'companion')?.action || 'voice'),
    mode: String(body.mode || ''),
    provider: String(body.llm?.provider || ''),
    failure: String(body.llm?.failure || ''),
    latency: body.llm?.latency || null
  };
}

async function readChatStream(response, onDelta) {
  if (!response.body) return { reply: '', mood: 'calm', failure: 'request_failed' };
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let partial = '';
  let doneBody = null;
  let streamFailure = '';
  const consume = (block) => {
    const message = parseChatStreamEvent(block);
    if (!message) return;
    if (message.event === 'delta') {
      partial = appendChatStreamDelta(partial, message.data?.text);
      onDelta?.(partial);
    } else if (message.event === 'done') {
      doneBody = message.data;
    } else if (message.event === 'error') {
      streamFailure = String(message.data?.failure || 'request_failed');
    }
  };
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    buffer += decoder.decode(chunk.value, { stream: true });
    const blocks = buffer.split(/\r?\n\r?\n/);
    buffer = blocks.pop() || '';
    blocks.forEach(consume);
  }
  buffer += decoder.decode();
  if (buffer.trim()) consume(buffer);
  if (streamFailure) return { reply: '', mood: 'calm', failure: streamFailure };
  return replyResultFromBody(response, doneBody);
}

async function requestReply(text, {
  history = state.history.slice(0, -1),
  probe = false,
  onDelta = null
} = {}) {
  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    cache: 'no-store',
    body: JSON.stringify({
      text,
      persona: personaFromStarter(),
      persona_short: personaFromStarter(),
      relationship: 'companion',
      scene: 'daily',
      history,
      soulmate: soulmatePromptProfile(state.profile, text),
      client_release: APP_RELEASE,
      probe,
      stream: true
    })
  });
  const type = response.headers.get('content-type') || '';
  if (response.ok && type.includes('text/event-stream')) {
    return readChatStream(response, onDelta);
  }
  const body = await response.json().catch(() => null);
  return replyResultFromBody(response, body);
}

async function sendMessage(rawText, { source = 'text' } = {}) {
  const text = String(rawText || '').replace(/\s+/g, ' ').trim().slice(0, 160);
  if (!text || state.busy || (source === 'voice' && looksLikeEcho(text))) return;
  stopListening();
  stopAudio({ clearQueue: true });
  state.busy = true;
  chatInput.value = '';
  appendMessage('user', text);
  updateProfile(growSoulmate(state.profile, { kind: 'chat', text }));
  setPhase('thinking');
  presenceLine.textContent = `${state.profile.name}正在理解你的话……`;
  let result;
  try {
    result = await requestReply(text, {
      onDelta(partial) {
        state.streamingReply = partial;
        conversationStateLabel.textContent = phaseLabels.speaking;
        presenceLine.textContent = partial;
        renderMessages();
      }
    });
  } catch (error) {
    result = { reply: '', mood: 'calm', failure: 'request_failed' };
  }
  state.streamingReply = '';
  renderLlmConnection(result);
  if (result.reauthenticate) {
    state.busy = false;
    setPhase('idle');
    presenceLine.textContent = llmFailureMessages.authentication_required;
    redirectToPrivateAccess();
    return;
  }
  if (!result.reply) {
    state.busy = false;
    setPhase('idle');
    showConversationError(result.failure);
    presenceLine.textContent = llmFailureMessages[result.failure] || '真实对话连接失败，请到设置中重新验证 API。';
    return;
  }
  appendMessage('assistant', result.reply);
  state.lastAssistantText = result.reply;
  state.lastAssistantAt = Date.now();
  presenceLine.textContent = result.reply;
  state.busy = false;
  await speakText(result.reply, {
    mood: result.mood,
    action: result.action,
    allowQueue: true
  });
}

async function fetchVoice(text, mood = 'happy', signal) {
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
        body,
        signal
      });
      const type = response.headers.get('content-type') || '';
      if (response.ok && type.includes('audio')) return response.blob();
      lastError = new Error(`voice ${response.status}`);
    } catch (error) {
      if (error?.name === 'AbortError' || signal?.aborted) throw error;
      lastError = error;
    }
    if (attempt === 0) {
      await new Promise((resolve) => window.setTimeout(resolve, 320));
      if (signal?.aborted) throw new DOMException('Voice request aborted', 'AbortError');
    }
  }
  throw lastError || new Error('voice unavailable');
}

function clearQueuedAudio() {
  if (state.queuedAudioUrl) URL.revokeObjectURL(state.queuedAudioUrl);
  state.queuedAudio = null;
  state.queuedAudioUrl = '';
  queuedAudioButton.hidden = true;
}

function unlockAudioPlayback() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return false;
  try {
    if (!state.audioContext) state.audioContext = new AudioContextClass();
    const context = state.audioContext;
    if (context.state === 'suspended') context.resume().catch(() => {});
    const source = context.createBufferSource();
    source.buffer = context.createBuffer(1, 1, context.sampleRate);
    source.connect(context.destination);
    source.start(0);
    source.onended = () => source.disconnect();
    return true;
  } catch (error) {
    return false;
  }
}

function stopAudio({ clearQueue = false, guardMs = 1000 } = {}) {
  if (state.voiceRequestController) state.voiceRequestController.abort();
  state.voiceRequestController = null;
  state.voiceRequestId += 1;
  state.playbackId += 1;
  const hadOutput = Boolean(state.currentAudio)
    || Boolean(state.currentAudioSource)
    || state.echoGuardUntil === Number.MAX_SAFE_INTEGER;
  if (state.currentAudioSource) {
    state.currentAudioSource.onended = null;
    try {
      state.currentAudioSource.stop(0);
    } catch (error) {
      // The source may already have completed naturally.
    }
    state.currentAudioSource.disconnect();
  }
  state.currentAudioSource = null;
  if (state.currentAudio) {
    state.currentAudio.pause();
    state.currentAudio.onended = null;
    state.currentAudio.onerror = null;
    state.currentAudio.removeAttribute('src');
  }
  if (state.currentAudioUrl) URL.revokeObjectURL(state.currentAudioUrl);
  state.currentAudio = null;
  state.currentAudioUrl = '';
  if (clearQueue) clearQueuedAudio();
  if (hadOutput) {
    const existingGuard = state.echoGuardUntil === Number.MAX_SAFE_INTEGER
      ? 0
      : state.echoGuardUntil;
    state.echoGuardUntil = Math.max(
      Number.isFinite(existingGuard) ? existingGuard : 0,
      Date.now() + guardMs
    );
  }
  setPhase(state.phase);
}

async function playUnlockedAudioBlob(blob, playbackId) {
  const context = state.audioContext;
  if (!context) return false;
  try {
    if (context.state === 'suspended') await context.resume();
    if (context.state !== 'running') return false;
    const buffer = await context.decodeAudioData(await blob.arrayBuffer());
    if (playbackId !== state.playbackId) return false;
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    state.currentAudioSource = source;
    state.echoGuardUntil = Number.MAX_SAFE_INTEGER;
    source.onended = () => {
      if (playbackId !== state.playbackId || state.currentAudioSource !== source) return;
      state.currentAudioSource = null;
      source.disconnect();
      stopAudio({ guardMs: 1800 });
      setPhase('idle');
    };
    setPhase('speaking');
    source.start(0);
    return true;
  } catch (error) {
    return false;
  }
}

async function playAudioBlob(blob, allowQueue = true) {
  stopListening();
  stopAudio({ clearQueue: true, guardMs: 0 });
  const playbackId = state.playbackId + 1;
  state.playbackId = playbackId;
  if (await playUnlockedAudioBlob(blob, playbackId)) return true;
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);
  audio.playsInline = true;
  state.currentAudio = audio;
  state.currentAudioUrl = url;
  state.echoGuardUntil = Number.MAX_SAFE_INTEGER;
  audio.onended = () => {
    if (playbackId !== state.playbackId) return;
    stopAudio({ guardMs: 1800 });
    setPhase('idle');
  };
  audio.onerror = () => {
    if (playbackId !== state.playbackId) return;
    stopAudio({ guardMs: 800 });
    setPhase('error');
  };
  setPhase('speaking');
  try {
    await audio.play();
  } catch (error) {
    if (playbackId !== state.playbackId) return false;
    stopAudio({ guardMs: 0 });
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

async function speakText(text, {
  mood = 'happy',
  action = '',
  allowQueue = false
} = {}) {
  stopListening();
  stopAudio({ clearQueue: true, guardMs: 0 });
  const requestId = state.voiceRequestId + 1;
  const controller = new AbortController();
  state.voiceRequestId = requestId;
  state.voiceRequestController = controller;
  setPhase('thinking', action);
  try {
    const blob = await fetchVoice(text, mood, controller.signal);
    if (controller.signal.aborted || requestId !== state.voiceRequestId) return false;
    state.voiceRequestController = null;
    return await playAudioBlob(blob, allowQueue);
  } catch (error) {
    if (state.voiceRequestController === controller) state.voiceRequestController = null;
    if (controller.signal.aborted || requestId !== state.voiceRequestId) return false;
    setPhase('offline');
    return false;
  }
}

function renderWakeButton() {
  wakeButton.disabled = !state.recognitionSupported;
  wakeButton.textContent = state.wakeEnabled ? '监听' : '唤醒';
  wakeButton.setAttribute('aria-pressed', state.wakeEnabled ? 'true' : 'false');
  wakeButton.setAttribute('aria-label', state.wakeEnabled ? '关闭语音唤醒' : '开启语音唤醒');
}

function scheduleWakeRecognition(delay = WAKE_RESTART_DELAY_MS) {
  window.clearTimeout(state.wakeRestartTimer);
  state.wakeRestartTimer = 0;
  if (!state.wakeEnabled || !state.recognition || document.visibilityState === 'hidden') return;
  state.wakeRestartTimer = window.setTimeout(() => {
    state.wakeRestartTimer = 0;
    if (!state.wakeEnabled || state.recognitionAccepting) return;
    if (
      state.busy
      || state.voiceRequestController
      || state.currentAudioSource
      || state.currentAudio
      || state.queuedAudio
      || ['acting', 'listening', 'thinking', 'speaking', 'ready'].includes(state.phase)
      || Date.now() < state.echoGuardUntil
    ) {
      scheduleWakeRecognition(900);
      return;
    }
    beginRecognition('wake');
  }, Math.max(0, delay));
}

function finishRecognitionSession({ resetPhase = true } = {}) {
  window.clearTimeout(state.recognitionTimeout);
  state.recognitionTimeout = 0;
  state.recognitionAccepting = false;
  state.recognitionMode = '';
  if (resetPhase && state.phase === 'listening') setPhase('idle');
}

function beginRecognition(mode) {
  if (!state.recognition || state.recognitionAccepting) return false;
  window.clearTimeout(state.wakeRestartTimer);
  state.wakeRestartTimer = 0;
  try {
    state.recognitionMode = mode;
    state.recognitionAccepting = true;
    state.recognitionResultReceived = false;
    state.recognition.start();
    if (mode === 'manual') {
      window.clearTimeout(state.recognitionTimeout);
      state.recognitionTimeout = window.setTimeout(() => {
        if (!state.recognitionAccepting || state.recognitionMode !== 'manual') return;
        presenceLine.textContent = '这次收音已结束，再按一次就能继续说。';
        stopListening();
      }, VOICE_LISTEN_TIMEOUT_MS);
      setPhase('listening');
    } else {
      renderWakeButton();
    }
    return true;
  } catch (error) {
    finishRecognitionSession();
    if (mode === 'wake') scheduleWakeRecognition(1200);
    return false;
  }
}

function handleRecognizedVoice(text, mode) {
  const command = parseVoiceControlCommand(text, {
    wakeWords: voiceWakeWords(state.profile?.name, state.profile?.starter),
    wakeActive: mode === 'manual' || Date.now() < state.wakeCommandUntil
  });
  if (command?.type === 'action') {
    state.wakeCommandUntil = 0;
    runCompanionAction(command.action, { source: 'voice' });
    return;
  }
  if (command?.type === 'wake') {
    state.wakeCommandUntil = Date.now() + VOICE_WAKE_COMMAND_WINDOW_MS;
    presenceLine.textContent = `我在。请在 ${VOICE_WAKE_COMMAND_WINDOW_MS / 1000} 秒内说出动作或想聊的话。`;
    scheduleWakeRecognition(220);
    return;
  }
  if (command?.type === 'message') {
    state.wakeCommandUntil = 0;
    sendMessage(command.remainder, { source: 'voice' });
    return;
  }
  if (mode === 'manual') sendMessage(text, { source: 'voice' });
  else scheduleWakeRecognition();
}

function setupRecognition() {
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Recognition) {
    micButton.disabled = true;
    micButton.textContent = '不可用';
    micButton.title = '当前浏览器不支持语音识别，请使用文字输入';
    micButton.setAttribute('aria-label', '当前浏览器不支持语音识别，请使用文字输入');
    renderWakeButton();
    return;
  }
  const recognition = new Recognition();
  recognition.lang = 'zh-CN';
  recognition.continuous = false;
  recognition.interimResults = false;
  recognition.onresult = (event) => {
    const mode = state.recognitionMode;
    const text = recognitionTranscript(event.results);
    const accepting = state.recognitionAccepting && Date.now() >= state.echoGuardUntil;
    state.recognitionResultReceived = Boolean(text);
    finishRecognitionSession();
    if (!text) {
      if (mode === 'manual') presenceLine.textContent = recognitionFailureMessage('no-speech');
      else scheduleWakeRecognition();
      return;
    }
    if (!accepting || looksLikeEcho(text)) {
      presenceLine.textContent = '已阻止语音回声，没有将它当成你的话。';
      scheduleWakeRecognition(900);
      return;
    }
    handleRecognizedVoice(text, mode);
  };
  recognition.onerror = (event) => {
    const mode = state.recognitionMode;
    const code = String(event?.error || '');
    const message = recognitionFailureMessage(code);
    finishRecognitionSession();
    if (mode === 'wake' && ['not-allowed', 'service-not-allowed', 'audio-capture'].includes(code)) {
      state.wakeEnabled = false;
      renderWakeButton();
      if (message) presenceLine.textContent = message;
      return;
    }
    if (mode === 'manual' && message) presenceLine.textContent = message;
    scheduleWakeRecognition(code === 'network' ? 1800 : 750);
  };
  recognition.onend = () => {
    const mode = state.recognitionMode;
    const endedWithoutResult = state.recognitionAccepting && !state.recognitionResultReceived;
    finishRecognitionSession();
    if (mode === 'manual' && endedWithoutResult) {
      presenceLine.textContent = recognitionFailureMessage('no-speech');
    }
    scheduleWakeRecognition();
  };
  state.recognition = recognition;
  state.recognitionSupported = true;
  renderWakeButton();
  setPhase(state.phase);
}

function startListening() {
  if (!state.recognition || state.busy) return;
  if (state.phase === 'listening' || state.listeningTimer) {
    stopListening();
    return;
  }
  if (state.recognitionMode === 'wake') stopListening({ resumeWake: false });
  const interrupting = Boolean(
    state.voiceRequestController
    || state.currentAudioSource
    || state.currentAudio
    || state.queuedAudio
    || ['speaking', 'ready'].includes(state.phase)
  );
  stopAudio({ clearQueue: true, guardMs: interrupting ? 500 : 0 });
  if (interrupting) presenceLine.textContent = '回答已打断，我在听你说。';
  const delay = Math.max(0, state.echoGuardUntil - Date.now(), interrupting ? 220 : 0);
  const start = () => {
    state.listeningTimer = 0;
    if (state.busy || state.voiceRequestController || state.currentAudioSource || state.currentAudio) {
      setPhase('idle');
      return;
    }
    beginRecognition('manual');
  };
  setPhase('listening');
  if (delay > 0) state.listeningTimer = window.setTimeout(start, delay + 30);
  else start();
}

function stopListening({ resumeWake = true } = {}) {
  window.clearTimeout(state.listeningTimer);
  window.clearTimeout(state.recognitionTimeout);
  state.listeningTimer = 0;
  state.recognitionTimeout = 0;
  if (!state.recognition) return;
  state.recognitionAccepting = false;
  state.recognitionMode = '';
  try { state.recognition.abort(); } catch (error) {}
  if (state.phase === 'listening') setPhase('idle');
  if (resumeWake) scheduleWakeRecognition();
}

function pauseWakeRecognition() {
  window.clearTimeout(state.wakeRestartTimer);
  state.wakeRestartTimer = 0;
  if (state.recognitionMode === 'wake') stopListening({ resumeWake: false });
}

function toggleWakeRecognition() {
  if (!state.recognitionSupported) return;
  state.wakeEnabled = !state.wakeEnabled;
  state.wakeCommandUntil = 0;
  if (state.wakeEnabled) {
    stopListening({ resumeWake: false });
    presenceLine.textContent = `语音唤醒已开启。可以说“${state.profile?.name || '伙伴'}，招招手”。`;
    scheduleWakeRecognition(0);
  } else {
    window.clearTimeout(state.wakeRestartTimer);
    state.wakeRestartTimer = 0;
    if (state.recognitionMode === 'wake') stopListening({ resumeWake: false });
    presenceLine.textContent = '语音唤醒已关闭。';
  }
  renderWakeButton();
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
  unlockAudioPlayback();
  if (!validateBirthStep()) return;
  if (state.birthStep === 4) completeBirth();
  else showBirthStep(state.birthStep + 1);
});

birthBack.addEventListener('click', () => showBirthStep(state.birthStep - 1));
birthRestoreOpen.addEventListener('click', () => {
  birthRestorePanel.hidden = !birthRestorePanel.hidden;
  birthRestoreOpen.textContent = birthRestorePanel.hidden ? '已有伙伴？用恢复码唤醒' : '收起恢复';
  if (!birthRestorePanel.hidden) window.setTimeout(() => birthRestoreInput.focus(), 80);
});
birthRestoreSubmit.addEventListener('click', restoreCloudSyncAtBirth);
birthForm.addEventListener('submit', (event) => {
  event.preventDefault();
  birthNext.click();
});

$$('[data-choice]').forEach((button) => {
  button.addEventListener('click', () => selectChoice(button.dataset.choice, button.dataset.value));
});

voicePreview.addEventListener('click', async () => {
  unlockAudioPlayback();
  voicePreview.disabled = true;
  voicePreview.textContent = '正在准备声音';
  const played = await speakText('你好。我正在等你给我一个名字。', { allowQueue: true });
  voicePreview.disabled = false;
  voicePreview.textContent = played ? '试听成功，再听一次' : '声音暂不可用，重试';
});

$$('[data-setting-voice]').forEach((button) => {
  button.addEventListener('click', async () => {
    if (!state.profile) return;
    unlockAudioPlayback();
    stopAudio();
    state.profile = { ...state.profile, voice: button.dataset.settingVoice, voiceCustomized: true };
    saveProfile();
    renderCompanion();
    voiceSettingStatus.textContent = `正在试听${voiceNames[state.profile.voice]}声线`;
    const played = await speakText(`你好，我是${state.profile.name}。这是我现在的声音。`, { allowQueue: true });
    voiceSettingStatus.textContent = played ? '声线已保存' : '声线已保存，云端语音暂不可用';
  });
});

companionTouch.addEventListener('click', () => {
  const opening = actionDock.hidden;
  setActionDockOpen(opening);
  if (opening) runCompanionAction('wave');
});
$$('[data-companion-action]').forEach((button) => {
  button.addEventListener('click', () => runCompanionAction(button.dataset.companionAction));
});
$$('[data-presence-action]').forEach((button) => {
  button.addEventListener('click', () => reactToTouch(button.dataset.presenceAction));
});

composer.addEventListener('submit', (event) => {
  event.preventDefault();
  unlockAudioPlayback();
  sendMessage(chatInput.value);
});

micButton.addEventListener('click', () => {
  unlockAudioPlayback();
  startListening();
});
wakeButton.addEventListener('click', () => {
  unlockAudioPlayback();
  toggleWakeRecognition();
});
queuedAudioButton.addEventListener('click', async () => {
  unlockAudioPlayback();
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
cloudSyncEnable.addEventListener('click', enableCloudSync);
cloudSyncNow.addEventListener('click', () => pushCloudState({ manual: true }));
cloudSyncShowCode.addEventListener('click', async () => {
  if (!state.cloudIdentity) return;
  const code = formatSoulmateRecoveryCode(state.cloudIdentity);
  cloudSyncCode.textContent = code;
  cloudSyncCode.hidden = false;
  try {
    await navigator.clipboard.writeText(code);
    setCloudSyncMessage('恢复码已显示并复制，请离线保管');
  } catch (error) {
    setCloudSyncMessage('恢复码已显示，请离线保管');
  }
});
cloudSyncRestore.addEventListener('click', restoreCloudSync);
cloudSyncStop.addEventListener('click', stopCloudSync);
cloudSyncDelete.addEventListener('click', removeCloudSync);
$('#export-button').addEventListener('click', exportProfile);
importButton.addEventListener('click', () => importInput.click());
importInput.addEventListener('change', async () => {
  await importProfile(importInput.files?.[0]);
  importInput.value = '';
});
$('#private-logout-button').addEventListener('click', async (event) => {
  const button = event.currentTarget;
  button.disabled = true;
  privateAccessStatus.textContent = '正在安全退出…';
  try {
    const response = await fetch('/api/access/logout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({})
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error('logout failed');
    location.replace(body.next || '/access/?signedOut=1');
  } catch (error) {
    privateAccessStatus.textContent = '暂时无法退出，请稍后重试。';
    button.disabled = false;
  }
});
$('#reset-button').addEventListener('click', async () => {
  const detail = state.cloudIdentity
    ? '这会停止本机同步并删除当前设备上的名字、人格和共同记忆。云端加密副本仍可通过恢复码找回。确定重新诞生吗？'
    : '这会删除当前伴侣的名字、人格和共同记忆。确定重新诞生吗？';
  if (!window.confirm(detail)) return;
  if (state.cloudIdentity) {
    await clearSoulmateDeviceCloudState(state.cloudIdentity);
    await clearSoulmateCloudDeviceState();
  }
  localStorage.removeItem(SOULMATE_STORAGE_KEY);
  localStorage.removeItem(SOULMATE_HISTORY_KEY);
  localStorage.removeItem(SOULMATE_SYNC_STORAGE_KEY);
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
state.history = state.profile ? loadHistory() : [];
if (state.profile && !state.history.length) {
  state.history = [cleanMessage({
    role: 'assistant',
    content: `你回来了。${state.profile.name}一直在等你。`
  })];
}
state.continuity = openSoulmateSync({
  onState: applyContinuityState,
  hydrateStoredState: !resetRequested
});

function revealInitialSurface() {
  startupStatus.hidden = true;
  if (state.profile) {
    saveProfile();
    birthFlow.hidden = true;
    companionView.hidden = false;
    renderMessages();
    renderCompanion();
    setPhase('idle');
  } else {
    birthFlow.hidden = false;
    companionView.hidden = true;
    showBirthStep(0);
    if (state.cloudRecoveryBlocked) {
      birthRestorePanel.hidden = false;
      birthRestoreOpen.textContent = '云端恢复暂时不可用';
      birthRestoreStatus.textContent = '请检查网络后刷新页面，或粘贴恢复码重试。';
      birthNext.disabled = true;
    }
  }
}

if (state.profile) {
  revealInitialSurface();
  void initializeCloudSync();
} else {
  await initializeCloudSync();
  revealInitialSurface();
}

window.addEventListener('online', () => {
  state.cloudWaitingForOnline = false;
  resumeCloudSync('网络已恢复，正在续传陪伴数据');
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    resumeCloudSync('伙伴已醒来，正在检查同步');
    scheduleWakeRecognition(300);
  } else if (state.recognitionMode === 'wake') {
    stopListening({ resumeWake: false });
  }
});

window.addEventListener('pageshow', (event) => {
  if (event.persisted) resumeCloudSync('伙伴已从休眠中醒来');
});

window.addEventListener('pagehide', (event) => {
  window.clearTimeout(state.cloudSyncTimer);
  window.clearTimeout(state.cloudRetryTimer);
  window.clearTimeout(state.wakeRestartTimer);
  if (state.recognitionMode === 'wake') stopListening({ resumeWake: false });
  if (!event.persisted) state.continuity?.close();
});
refreshLlmConnection();

if (pendantSimulationMode) {
  pendantStatus.textContent = '电脑模拟设备待连接';
  pendantButton.textContent = '连接模拟器';
  Object.defineProperty(window, '__NEXORA_LAB__', {
    configurable: true,
    value: Object.freeze({
      connectPendant,
      interact: reactToTouch,
      runAction: runCompanionAction,
      parseVoiceCommand: (text, wakeActive = false) => parseVoiceControlCommand(text, {
        wakeWords: voiceWakeWords(state.profile?.name, state.profile?.starter),
        wakeActive
      }),
      publishState: () => state.continuity?.publish(state.profile, state.history),
      sendMessage,
      setPhase,
      getState: () => ({
        phase: state.phase,
        activeAction: state.activeAction,
        wakeEnabled: state.wakeEnabled,
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

async function clearLegacyRuntimeCaches() {
  if (location.protocol === 'file:') return;
  if ('caches' in window) {
    const keys = await caches.keys();
    await Promise.all(keys.map((key) => caches.delete(key)));
  }
  if ('serviceWorker' in navigator) {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((registration) => registration.unregister()));
  }
}

clearLegacyRuntimeCaches().catch(() => {});
