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

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const lab = $('#display-lab');
const shell = $('#device-shell');
const character = $('#screen-character');
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
let demoTimer = 0;

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

  shell.dataset.state = snapshot.state;
  shell.dataset.tone = snapshot.tone;
  shell.dataset.starter = snapshot.companion.starter;
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
  if (character.src !== new URL(snapshot.companion.asset, location.href).href) character.src = snapshot.companion.asset;
  character.alt = `${snapshot.companion.name}的${snapshot.companion.stageName}形象`;
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

function setDisplayState(next) {
  window.clearTimeout(demoTimer);
  state.display = next;
  render();
}

function runDemo() {
  window.clearTimeout(demoTimer);
  const sequence = [
    ['boot', 1200],
    ['idle', 1800],
    ['listening', 2200],
    ['thinking', 1800],
    ['speaking', 2600],
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

if (embedded) {
  document.body.classList.add('embedded');
  lab.setAttribute('aria-label', 'NC-01 240×240 嵌入式屏幕');
}

syncStageOptions();
render();
if (state.display === 'boot') demoTimer = window.setTimeout(() => setDisplayState('idle'), 1600);
