import {
  createSoulmateProfile,
  normalizeSoulmateProfile,
  soulmateStarterCatalog,
  stageProgress,
  stagesForStarter
} from './soulmate-profile.mjs';

export const PENDANT_DISPLAY_SIZE = 240;

export const pendantDisplayStates = Object.freeze({
  boot: { label: '正在醒来', tone: 'cyan', lights: [1, 0, 0, 0] },
  idle: { label: '在你身边', tone: 'calm', lights: [0, 0, 0, 0] },
  listening: { label: '我在听', tone: 'cyan', lights: [1, 1, 1, 1] },
  thinking: { label: '想一想', tone: 'cyan', lights: [1, 0, 1, 0] },
  speaking: { label: '正在回应', tone: 'coral', lights: [1, 1, 1, 1] },
  notice: { label: '有件事想告诉你', tone: 'coral', lights: [1, 0, 0, 1] },
  charging: { label: '正在补充能量', tone: 'cyan', lights: [0, 1, 1, 0] },
  'low-power': { label: '需要充电', tone: 'danger', lights: [1, 0, 0, 0] },
  sleep: { label: '', tone: 'sleep', lights: [0, 0, 0, 0] }
});

const interactionSequence = ['idle', 'listening', 'thinking', 'speaking', 'idle'];

function boundedNumber(value, fallback, min, max) {
  const number = Number(value);
  return Math.max(min, Math.min(max, Number.isFinite(number) ? number : fallback));
}

function cleanNotice(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 16);
}

export function nextPendantInteractionState(state = 'idle') {
  const index = interactionSequence.indexOf(state);
  return interactionSequence[(index < 0 ? 0 : index + 1) % interactionSequence.length];
}

export function createPendantDisplaySnapshot(profile, options = {}, now = Date.now()) {
  const current = normalizeSoulmateProfile(profile, now) || createSoulmateProfile({ name: '星澜' }, now);
  const requestedState = pendantDisplayStates[options.state] ? options.state : 'idle';
  const battery = Math.round(boundedNumber(options.battery, 76, 0, 100));
  const state = battery <= 10 && !['charging', 'boot', 'sleep'].includes(requestedState)
    ? 'low-power'
    : requestedState;
  const stages = stagesForStarter(current.starter);
  const requestedStage = stages.find((stage) => stage.id === options.stage);
  const stage = requestedStage || stageProgress(current).stage;
  const starter = soulmateStarterCatalog[current.starter] || soulmateStarterCatalog.cute;
  const notice = cleanNotice(options.notice);

  return {
    display: { width: PENDANT_DISPLAY_SIZE, height: PENDANT_DISPLAY_SIZE, shape: 'round' },
    state,
    stateLabel: state === 'notice' && notice ? notice : pendantDisplayStates[state].label,
    tone: pendantDisplayStates[state].tone,
    lights: pendantDisplayStates[state].lights,
    battery,
    connected: options.connected !== false,
    muted: Boolean(options.muted),
    companion: {
      name: current.name,
      starter: current.starter,
      species: starter.species,
      stage: stage.id,
      stageName: stage.name,
      bond: current.bond,
      asset: `../soulmate/${stage.asset.replace(/^\.\//, '')}`
    }
  };
}
