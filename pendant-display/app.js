import {
  SOULMATE_STORAGE_KEY,
  createSoulmateProfile,
  normalizeSoulmateProfile,
  soulmateStarterCatalog,
  stageProgress,
  stagesForStarter
} from '../shared/soulmate-profile.mjs';
import {
  createPendantDisplaySnapshot,
  pendantDisplayStates
} from '../shared/pendant-display.mjs';
import { observePendantSimulator } from '../shared/pendant-simulator.mjs';
import { Creature3DViewer } from '../shared/creature-3d-viewer.mjs?v=25';
import { creatureActionForPhase } from '../shared/creature-3d-data.mjs?v=15';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const lab = $('#display-lab');
const shell = $('#device-shell');
const roundDisplay = $('#round-display');
const screenModel = $('#screen-model');
const screenName = $('#screen-name');
const screenConnection = $('#screen-connection');
const screenBattery = $('#screen-battery');
const screenState = $('#screen-state');
const screenBond = $('#screen-bond');
const starterSelect = $('#starter-select');
const stageSelect = $('#stage-select');
const batteryInput = $('#battery-input');
const batteryOutput = $('#battery-output');
const connectionInput = $('#connection-input');
const demoButton = $('#demo-button');

const params = new URLSearchParams(location.search);
const embedded = params.get('embedded') === '1';
const simulatorMode = params.get('lab') === '1' || params.get('simulator') === '1';
const explicitPreview = ['starter', 'stage', 'state', 'battery', 'connected']
  .some((key) => params.has(key));
let demoTimer = 0;
let interactionTimer = 0;
let tapTimer = 0;
let holdTimer = 0;
let holdTriggered = false;
let lastTapAt = 0;
let currentSnapshot = null;
let creatureViewer = null;
let lastModelError = '';
const warmedCreatureForms = new Set();
const interactionActions = ['affection', 'wave'];

function ensureCreatureViewer() {
  if (creatureViewer) return creatureViewer;
  try {
    creatureViewer = new Creature3DViewer(screenModel, {
      compact: true,
      frustumHeight: 2,
      cameraDistance: 4.55,
      baseYaw: simulatorMode
        ? Number(params.get('debugYaw') || 0) * Math.PI / 180
        : 0,
      onError(error) {
        lastModelError = String(error?.message || error || '3D 动作加载失败').slice(0, 120);
      }
    });
  } catch (error) {
    lastModelError = String(error?.message || error || '无法启动 3D 渲染').slice(0, 120);
    screenModel.dataset.modelState = 'error';
  }
  return creatureViewer;
}

function storedProfile() {
  try {
    return normalizeSoulmateProfile(JSON.parse(localStorage.getItem(SOULMATE_STORAGE_KEY) || 'null'));
  } catch (error) {
    return null;
  }
}

const saved = storedProfile();
const profile = saved || createSoulmateProfile({
  name: '星澜',
  starter: params.get('starter') || 'cute',
  temperament: 'warm'
});

const state = {
  profile,
  display: pendantDisplayStates[params.get('state')] ? params.get('state') : 'boot',
  starter: params.get('starter') && soulmateStarterCatalog[params.get('starter')]
    ? params.get('starter')
    : profile.starter,
  stage: params.get('stage') || stageProgress(profile).stage.id,
  battery: Math.max(0, Math.min(100, Number(params.get('battery')) || 76)),
  connected: params.get('connected') !== '0',
  notice: params.get('notice') || '该休息一下啦'
};

function syncStageOptions() {
  const stages = stagesForStarter(state.starter);
  stageSelect.textContent = '';
  stages.forEach((stage) => {
    const option = document.createElement('option');
    option.value = stage.id;
    option.textContent = stage.name;
    stageSelect.appendChild(option);
  });
  if (!stages.some((stage) => stage.id === state.stage)) state.stage = stages[0].id;
  stageSelect.value = state.stage;
}

function render() {
  const currentProfile = { ...state.profile, starter: state.starter };
  const snapshot = createPendantDisplaySnapshot(currentProfile, {
    state: state.display,
    stage: state.stage,
    battery: state.battery,
    connected: state.connected,
    notice: state.notice
  });
  currentSnapshot = snapshot;

  shell.dataset.state = snapshot.state;
  shell.dataset.tone = snapshot.tone;
  shell.dataset.starter = snapshot.companion.starter;
  shell.dataset.stage = snapshot.companion.stage;
  shell.dataset.pose = snapshot.companion.pose;
  shell.style.setProperty('--battery-level', `${snapshot.battery}%`);
  snapshot.lights.forEach((active, index) => {
    const light = $(`.light-guide-${['one', 'two', 'three', 'four'][index]}`);
    light.classList.toggle('active', Boolean(active));
  });
  screenName.textContent = snapshot.companion.name;
  screenBattery.textContent = snapshot.battery;
  screenState.textContent = snapshot.stateLabel;
  screenBond.textContent = `R ${String(snapshot.companion.bond).padStart(2, '0').slice(-2)}`;
  screenConnection.classList.toggle('offline', !snapshot.connected);
  screenConnection.setAttribute('aria-label', snapshot.connected ? '蓝牙已连接' : '蓝牙未连接');
  const viewer = ensureCreatureViewer();
  if (viewer) {
    const action = creatureActionForPhase[snapshot.state] || 'idle';
    const formKey = `${snapshot.companion.starter}:${snapshot.companion.stage}`;
    lastModelError = '';
    viewer.load(snapshot.companion.starter, action, snapshot.companion.stage).then((loaded) => {
      if (!loaded || warmedCreatureForms.has(formKey)) return;
      warmedCreatureForms.add(formKey);
      viewer.preload(snapshot.companion.starter, interactionActions, snapshot.companion.stage)
        .then((results) => {
          if (results.some((result) => result.status === 'rejected')) warmedCreatureForms.delete(formKey);
        });
    });
  }
  batteryInput.value = String(snapshot.battery);
  batteryOutput.value = `${snapshot.battery}%`;
  connectionInput.checked = snapshot.connected;
  starterSelect.value = snapshot.companion.starter;
  $$('[data-display-state]').forEach((button) => {
    const active = button.dataset.displayState === snapshot.state;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
}

function applySimulatorSnapshot(snapshot) {
  state.profile = {
    ...state.profile,
    id: snapshot.profileId,
    name: snapshot.name,
    starter: snapshot.starter,
    bond: snapshot.bond
  };
  state.starter = snapshot.starter;
  state.stage = snapshot.stage;
  state.display = snapshot.state;
  state.connected = true;
  if (snapshot.battery !== undefined) state.battery = snapshot.battery;
  if (snapshot.notice) state.notice = snapshot.notice;
  syncStageOptions();
  render();
}

function setDisplayState(next) {
  window.clearTimeout(demoTimer);
  window.clearTimeout(interactionTimer);
  state.display = next;
  render();
}

function setTransientState(next, duration = 1100) {
  setDisplayState(next);
  roundDisplay.classList.remove('interaction-fired');
  void roundDisplay.offsetWidth;
  roundDisplay.classList.add('interaction-fired');
  interactionTimer = window.setTimeout(() => {
    roundDisplay.classList.remove('interaction-fired');
    state.display = 'idle';
    render();
  }, duration);
}

function runDemo() {
  window.clearTimeout(demoTimer);
  const sequence = [
    ['boot', 1200],
    ['idle', 1800],
    ['affection', 1300],
    ['listening', 2200],
    ['thinking', 1800],
    ['speaking', 2600],
    ['happy', 1500],
    ['notice', 1800],
    ['idle', 0]
  ];
  let index = 0;
  const advance = () => {
    const [next, delay] = sequence[index];
    state.display = next;
    render();
    index += 1;
    if (index < sequence.length) demoTimer = window.setTimeout(advance, delay);
  };
  advance();
}

starterSelect.addEventListener('change', () => {
  state.starter = starterSelect.value;
  state.stage = '';
  syncStageOptions();
  render();
});

stageSelect.addEventListener('change', () => {
  state.stage = stageSelect.value;
  render();
});

batteryInput.addEventListener('input', () => {
  state.battery = Number(batteryInput.value);
  render();
});

connectionInput.addEventListener('change', () => {
  state.connected = connectionInput.checked;
  render();
});

$$('[data-display-state]').forEach((button) => {
  button.addEventListener('click', () => setDisplayState(button.dataset.displayState));
});

demoButton.addEventListener('click', runDemo);

roundDisplay.addEventListener('pointerdown', (event) => {
  if (event.button !== 0) return;
  holdTriggered = false;
  roundDisplay.setPointerCapture?.(event.pointerId);
  holdTimer = window.setTimeout(() => {
    holdTriggered = true;
    setTransientState('listening', 1500);
  }, 560);
});

roundDisplay.addEventListener('pointerup', () => {
  window.clearTimeout(holdTimer);
  if (holdTriggered) return;
  const now = Date.now();
  if (now - lastTapAt < 320) {
    window.clearTimeout(tapTimer);
    lastTapAt = 0;
    setTransientState('happy', 1300);
    return;
  }
  lastTapAt = now;
  tapTimer = window.setTimeout(() => {
    lastTapAt = 0;
    setTransientState('affection', 1100);
  }, 330);
});

roundDisplay.addEventListener('pointercancel', () => window.clearTimeout(holdTimer));
roundDisplay.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') setTransientState('affection', 1100);
  if (event.key === ' ') {
    event.preventDefault();
    setTransientState('listening', 1500);
  }
});

if (embedded) {
  document.body.classList.add('embedded');
  lab.setAttribute('aria-label', 'NC-01 240×240 嵌入式屏幕');
}

if (simulatorMode) {
  observePendantSimulator(applySimulatorSnapshot, globalThis.localStorage, {
    replayStored: !explicitPreview
  });
  Object.defineProperty(window, '__NEXORA_PENDANT_LAB__', {
    configurable: true,
    value: Object.freeze({
      applySnapshot: applySimulatorSnapshot,
      setBattery(value) {
        state.battery = Math.max(0, Math.min(100, Number(value) || 0));
        render();
      },
      setConnected(value) {
        state.connected = Boolean(value);
        render();
      },
      setState: setDisplayState,
      setCompanionForm(starter, stage = 'seed') {
        if (!soulmateStarterCatalog[starter]) return false;
        state.starter = starter;
        state.stage = stage;
        syncStageOptions();
        render();
        return true;
      },
      loadModel(starter, action = 'idle', stage = 'seed') {
        const viewer = ensureCreatureViewer();
        return viewer ? viewer.load(starter, action, stage) : Promise.resolve(false);
      },
      getSnapshot: () => currentSnapshot ? structuredClone(currentSnapshot) : null,
      getModelState: () => ({
        ...(creatureViewer?.getState() || {
          starter: state.starter,
          action: 'idle',
          status: screenModel.dataset.modelState || 'loading'
        }),
        identity: creatureViewer?.identity || '',
        error: lastModelError
      }),
      sampleModel: () => creatureViewer?.samplePixels() || null
    })
  });
  window.dispatchEvent(new CustomEvent('nexora:pendant-lab-ready'));
}

syncStageOptions();
render();
if (state.display === 'boot') demoTimer = window.setTimeout(() => setDisplayState('idle'), 1600);
