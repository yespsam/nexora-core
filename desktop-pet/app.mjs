import { Creature3DViewer } from '../shared/creature-3d-viewer.mjs?v=27';

const stage = document.querySelector('#pet-stage');
const bubble = document.querySelector('#speech-bubble');
const conversation = document.querySelector('#conversation');
const conversationStatus = document.querySelector('#conversation-status');
const conversationForm = document.querySelector('#conversation-form');
const conversationInput = document.querySelector('#conversation-input');
const conversationSend = document.querySelector('#conversation-send');
const conversationClose = document.querySelector('#conversation-close');
const params = new URLSearchParams(location.search);
const starters = new Set(['cute', 'cool', 'beautiful']);
const stages = new Set(['seed', 'young', 'resonance']);
const actions = new Set(['idle', 'listening', 'nod', 'affection', 'wave', 'speaking', 'walk', 'run']);
const clickActions = ['wave', 'nod', 'affection'];
const actionLines = Object.freeze({
  wave: '看到你了',
  nod: '嗯，我在听',
  affection: '陪你待一会儿',
  listening: '我在听',
  speaking: '正在回应你'
});

const state = {
  starter: starters.has(params.get('starter')) ? params.get('starter') : 'cute',
  stage: stages.has(params.get('stage')) ? params.get('stage') : 'seed',
  name: String(params.get('name') || '').trim().slice(0, 12),
  action: 'idle',
  clickIndex: 0,
  actionTimer: 0,
  bubbleTimer: 0,
  clickTimer: 0,
  pointerStart: null,
  dragged: false,
  conversationOpen: false,
  conversationBusy: false
};

let voiceAudio = null;

const postNative = (message) => {
  try {
    globalThis.webkit?.messageHandlers?.desktopPet?.postMessage(message);
  } catch (error) {}
  try {
    globalThis.chrome?.webview?.postMessage(message);
  } catch (error) {}
};

const viewer = new Creature3DViewer(stage, {
  frustumHeight: 2.58,
  cameraDistance: 6,
  exposure: 1.02,
  interactiveRotation: false,
  onLoad(modelState) {
    postNative({ type: 'model-ready', ...modelState });
  },
  onError(error) {
    postNative({ type: 'model-error', message: String(error?.message || 'model load failed').slice(0, 160) });
  }
});

function safeStarter(value) {
  return starters.has(value) ? value : state.starter;
}

function safeStage(value) {
  return stages.has(value) ? value : state.stage;
}

function safeAction(value) {
  return actions.has(value) ? value : 'idle';
}

function showBubble(text, duration = 2100) {
  const visibleText = String(text || '').trim().slice(0, 24);
  window.clearTimeout(state.bubbleTimer);
  if (!visibleText) {
    bubble.hidden = true;
    bubble.textContent = '';
    return;
  }
  bubble.textContent = visibleText;
  bubble.hidden = false;
  state.bubbleTimer = window.setTimeout(() => {
    bubble.hidden = true;
  }, duration);
}

function setConversationOpen(open, status = '') {
  if (open && typeof open === 'object') {
    status = open.status || status;
    open = open.open;
  }
  state.conversationOpen = Boolean(open);
  conversation.hidden = !state.conversationOpen;
  if (status) conversationStatus.textContent = String(status).trim().slice(0, 80);
  postNative({ type: 'conversation-state', open: state.conversationOpen });
  if (state.conversationOpen) {
    window.setTimeout(() => conversationInput.focus(), 0);
  } else {
    voiceAudio?.pause();
    voiceAudio = null;
    state.conversationBusy = false;
    conversationInput.disabled = false;
    conversationSend.disabled = false;
    conversationInput.blur();
  }
}

function setConversationState(input = {}) {
  const phase = String(input.phase || 'idle');
  const status = String(input.status || '').trim().slice(0, 80);
  state.conversationBusy = ['thinking', 'speaking'].includes(phase);
  conversationInput.disabled = state.conversationBusy;
  conversationSend.disabled = state.conversationBusy;
  if (status) conversationStatus.textContent = status;
  if (phase === 'thinking') play('listening', { line: '', duration: 0 });
  if (phase === 'speaking') play('speaking', { line: status, duration: 0 });
  if (phase === 'error') play('idle', { line: '', duration: 0 });
  if (phase === 'idle') play('idle', { line: '', duration: 0 });
}

function receiveReply(input = {}) {
  const text = String(input.text || '').trim().slice(0, 300);
  const requestedAction = input.action === 'voice' ? 'speaking' : String(input.action || 'speaking');
  const action = actions.has(requestedAction) ? requestedAction : 'speaking';
  if (!text) return;
  state.conversationBusy = false;
  conversationInput.disabled = false;
  conversationSend.disabled = false;
  conversationStatus.textContent = text;
  play(action || 'speaking', { line: text, duration: Math.max(3200, Math.min(9000, text.length * 170)) });
  window.setTimeout(() => conversationInput.focus(), 0);
}

async function playVoice(input = {}) {
  const mime = String(input.mime || 'audio/mpeg').replace(/[^a-z0-9.+/-]/gi, '');
  const data = String(input.data || '');
  if (!data) return false;
  voiceAudio?.pause();
  voiceAudio = new Audio(`data:${mime};base64,${data}`);
  voiceAudio.addEventListener('ended', () => setConversationState({ phase: 'idle', status: '' }), { once: true });
  voiceAudio.addEventListener('error', () => setConversationState({ phase: 'idle', status: '' }), { once: true });
  try {
    await voiceAudio.play();
    return true;
  } catch (error) {
    setConversationState({ phase: 'idle', status: '' });
    return false;
  }
}

async function play(action, options = {}) {
  if (action && typeof action === 'object') {
    options = action;
    action = action.action;
  }
  const { line = '', duration = 2600 } = options;
  const nextAction = safeAction(action);
  window.clearTimeout(state.actionTimer);
  state.action = nextAction;
  const loaded = await viewer.load(state.starter, nextAction, state.stage);
  if (!loaded) return false;
  if (line || actionLines[nextAction]) showBubble(line || actionLines[nextAction]);
  postNative({ type: 'interaction', action: nextAction });
  if (nextAction !== 'idle' && duration > 0) {
    state.actionTimer = window.setTimeout(() => {
      state.action = 'idle';
      viewer.load(state.starter, 'idle', state.stage);
    }, duration);
  }
  return true;
}

async function configure(input = {}) {
  state.starter = safeStarter(input.starter);
  state.stage = safeStage(input.stage);
  state.name = String(input.name || state.name || '').trim().slice(0, 12);
  stage.setAttribute('aria-label', state.name ? `${state.name}，NEXORA 3D 桌面伙伴` : 'NEXORA 3D 桌面伙伴');
  state.action = safeAction(input.action || state.action);
  return viewer.load(state.starter, state.action, state.stage);
}

stage.addEventListener('pointerdown', (event) => {
  state.pointerStart = { x: event.clientX, y: event.clientY };
  state.dragged = false;
  stage.setPointerCapture?.(event.pointerId);
  postNative({ type: 'pointer-down' });
});

stage.addEventListener('pointermove', (event) => {
  if (!state.pointerStart) return;
  if (Math.hypot(event.clientX - state.pointerStart.x, event.clientY - state.pointerStart.y) > 5) {
    state.dragged = true;
    postNative({ type: 'pointer-move' });
  }
});

const releasePointer = (event) => {
  if (state.pointerStart) postNative({ type: 'pointer-up' });
  if (event?.pointerId !== undefined && stage.hasPointerCapture?.(event.pointerId)) {
    stage.releasePointerCapture(event.pointerId);
  }
  state.pointerStart = null;
};

stage.addEventListener('pointerup', releasePointer);
stage.addEventListener('pointercancel', releasePointer);

stage.addEventListener('click', () => {
  if (state.conversationOpen) return;
  if (state.dragged) {
    state.dragged = false;
    return;
  }
  window.clearTimeout(state.clickTimer);
  state.clickTimer = window.setTimeout(() => {
    const action = clickActions[state.clickIndex % clickActions.length];
    state.clickIndex += 1;
    play(action);
  }, 190);
});

stage.addEventListener('dblclick', () => {
  window.clearTimeout(state.clickTimer);
  setConversationOpen(!state.conversationOpen);
});

stage.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  event.preventDefault();
  const action = clickActions[state.clickIndex % clickActions.length];
  state.clickIndex += 1;
  play(action);
});

stage.addEventListener('contextmenu', (event) => event.preventDefault());

stage.addEventListener('wheel', (event) => {
  if (event.target.closest?.('#conversation')) return;
  event.preventDefault();
  postNative({ type: 'resize', deltaY: event.deltaY });
}, { passive: false });

conversation.addEventListener('pointerdown', (event) => event.stopPropagation());
conversation.addEventListener('pointermove', (event) => event.stopPropagation());
conversation.addEventListener('pointerup', (event) => event.stopPropagation());
conversation.addEventListener('click', (event) => event.stopPropagation());
conversation.addEventListener('dblclick', (event) => event.stopPropagation());
conversation.addEventListener('keydown', (event) => event.stopPropagation());

conversationForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const text = conversationInput.value.replace(/\s+/g, ' ').trim().slice(0, 160);
  if (!text || state.conversationBusy) return;
  conversationInput.value = '';
  setConversationState({ phase: 'thinking', status: `${state.name || '伙伴'}正在理解……` });
  postNative({ type: 'chat-submit', text });
});

conversationClose.addEventListener('click', () => setConversationOpen(false));

conversationInput.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  event.preventDefault();
  setConversationOpen(false);
});

window.NexoraDesktopPet = Object.freeze({
  configure,
  play,
  showBubble,
  setConversationOpen,
  setConversationState,
  receiveReply,
  playVoice,
  getState: () => ({ ...state, viewer: viewer.getState() })
});

window.__NEXORA_DESKTOP_PET_QA__ = Object.freeze({
  sampleModel: () => viewer.samplePixels(),
  getState: () => window.NexoraDesktopPet.getState()
});

configure({ action: 'idle' }).then((loaded) => {
  if (!loaded) return;
  viewer.preload(state.starter, ['wave', 'nod', 'affection', 'speaking'], state.stage);
  postNative({ type: 'ready' });
});
