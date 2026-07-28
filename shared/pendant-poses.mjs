export const pendantPoseIds = Object.freeze([
  'idle',
  'affection',
  'listening',
  'thinking',
  'speaking',
  'happy'
]);

const validPoses = new Set(pendantPoseIds);
const validRoutes = new Set(['cute', 'cool', 'beautiful']);
const validStages = new Set(['seed', 'young', 'resonance']);

const statePoseMap = Object.freeze({
  idle: 'idle',
  affection: 'affection',
  listening: 'listening',
  thinking: 'thinking',
  speaking: 'speaking',
  happy: 'happy',
  notice: 'happy',
  charging: 'idle',
  'low-power': 'idle',
  boot: 'idle',
  sleep: 'idle'
});

export function poseForPendantState(state = 'idle') {
  return statePoseMap[state] || 'idle';
}

export function pendantPoseAsset(route, stage, pose = 'idle', root = '../soulmate/assets/starters/poses') {
  const safeRoute = validRoutes.has(route) ? route : 'cute';
  const safeStage = validStages.has(stage) ? stage : 'seed';
  const safePose = validPoses.has(pose) ? pose : 'idle';
  return `${root}/${safeRoute}-${safeStage}-${safePose}-v1.webp`;
}

export function pendantPoseAssets(route, stage, root) {
  return pendantPoseIds.map((pose) => pendantPoseAsset(route, stage, pose, root));
}
