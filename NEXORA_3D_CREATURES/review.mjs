import { Creature3DViewer } from '../shared/creature-3d-viewer.mjs?v=23';
import { creature3DEntry } from '../shared/creature-3d-data.mjs?v=14';

const stage = document.querySelector('#model-stage');
const name = document.querySelector('#model-name');
const status = document.querySelector('#load-state');
let starter = 'cute';
let action = 'idle';

const viewer = new Creature3DViewer(stage, {
  cameraDistance: 6,
  onLoad() {
    status.textContent = '';
  },
  onError() {
    status.textContent = '模型载入失败，请通过本地服务器或云端页面打开';
  }
});

Object.defineProperty(window, '__NEXORA_CREATURE_REVIEW__', {
  configurable: true,
  value: Object.freeze({ viewer })
});

function load() {
  const entry = creature3DEntry(starter);
  name.textContent = entry.name;
  status.textContent = '正在载入原生 3D 模型';
  viewer.resetView();
  viewer.load(starter, action);
}

document.querySelectorAll('[data-starter]').forEach((button) => {
  button.addEventListener('click', () => {
    starter = button.dataset.starter;
    document.querySelectorAll('[data-starter]').forEach((item) => item.classList.toggle('active', item === button));
    load();
  });
});

document.querySelectorAll('[data-action]').forEach((button) => {
  button.addEventListener('click', () => {
    action = button.dataset.action;
    document.querySelectorAll('[data-action]').forEach((item) => item.classList.toggle('active', item === button));
    load();
  });
});

load();
