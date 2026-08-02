import { Creature3DViewer } from '../shared/creature-3d-viewer.mjs?v=27';

const stage = document.querySelector('#pet-stage');
const bubble = document.querySelector('#speech-bubble');
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
  dragged: false
};

const postNative = (message) => {
  try {
    globalThis.webkit?.messageHandlers?.desktopPet?.postMessage(message);
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
});

stage.addEventListener('pointermove', (event) => {
  if (!state.pointerStart) return;
  if (Math.hypot(event.clientX - state.pointerStart.x, event.clientY - state.pointerStart.y) > 5) {
    state.dragged = true;
  }
});

const releasePointer = () => {
  state.pointerStart = null;
};

stage.addEventListener('pointerup', releasePointer);
stage.addEventListener('pointercancel', releasePointer);

stage.addEventListener('click', () => {
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
  postNative({ type: 'open-chat' });
});

stage.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  event.preventDefault();
  const action = clickActions[state.clickIndex % clickActions.length];
  state.clickIndex += 1;
  play(action);
});

stage.addEventListener('contextmenu', (event) => event.preventDefault());

window.NexoraDesktopPet = Object.freeze({
  configure,
  play,
  showBubble,
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
