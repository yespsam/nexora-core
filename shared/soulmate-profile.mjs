import {
  normalizeSoulmateMemories,
  recallSoulmateMemories,
  rememberSoulmateInteraction
} from './soulmate-memory.mjs';

export const SOULMATE_PROFILE_VERSION = 1;
export const SOULMATE_EXPORT_VERSION = 1;
export const SOULMATE_STORAGE_KEY = 'soulmate-profile-v1';
export const SOULMATE_HISTORY_KEY = 'soulmate-history-v1';

const starterRoute = (id, name, species, description, stageNames) => Object.freeze({
  id,
  name,
  species,
  description,
  stages: Object.freeze([
    {
      id: 'seed',
      name: stageNames[0],
      minBond: 0,
      nextBond: 80,
      asset: `./assets/starters/${id}-seed-v1.webp`,
      description: '它正在认识你的声音和日常。'
    },
    {
      id: 'young',
      name: stageNames[1],
      minBond: 80,
      nextBond: 240,
      asset: `./assets/starters/${id}-young-v1.webp`,
      description: '它开始表达偏好，也会主动关心你。'
    },
    {
      id: 'resonance',
      name: stageNames[2],
      minBond: 240,
      nextBond: null,
      asset: `./assets/starters/${id}-resonance-v1.webp`,
      description: '你们共同塑造了它的性格、能力和外形。'
    }
  ])
});

export const soulmateStarterCatalog = Object.freeze({
  cute: starterRoute(
    'cute',
    '可爱型',
    '绒云兽',
    '亲近、活泼，喜欢主动贴近你。',
    ['绒云幼体', '绒云成长体', '绒心共鸣体']
  ),
  cool: starterRoute(
    'cool',
    '帅气型',
    '曜影兽',
    '敏锐、果断，常常安静地守在你身边。',
    ['曜影幼体', '曜影成长体', '曜影共鸣体']
  ),
  beautiful: starterRoute(
    'beautiful',
    '优美型',
    '月羽灵',
    '安静、细腻，会留意情绪里的微小变化。',
    ['月羽幼体', '月羽成长体', '月华共鸣体']
  )
});

export const soulmateStarters = Object.freeze(Object.values(soulmateStarterCatalog));
export const soulmateStages = soulmateStarterCatalog.cute.stages;

const genderIds = new Set(['female', 'male', 'neutral']);
const voiceIds = new Set(['soft', 'bright', 'steady']);
const temperamentIds = new Set(['warm', 'curious', 'steady']);
const starterIds = new Set(Object.keys(soulmateStarterCatalog));

export const soulmateDefaultVoiceByStarter = Object.freeze({
  cute: 'bright',
  cool: 'steady',
  beautiful: 'soft'
});

export function defaultVoiceForStarter(starter = 'cute') {
  return soulmateDefaultVoiceByStarter[starter] || soulmateDefaultVoiceByStarter.cute;
}

function cleanText(value, limit) {
  return String(value || '')
    .replace(/[<>&]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, limit);
}

function cleanDate(value, fallback) {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) ? String(value) : fallback;
  return date;
}

function numeric(value, fallback, min = 0, max = 10000) {
  return Math.max(min, Math.min(max, Number.isFinite(Number(value)) ? Number(value) : fallback));
}

export function stagesForStarter(starter = 'cute') {
  return (soulmateStarterCatalog[starter] || soulmateStarterCatalog.cute).stages;
}

export function stageForBond(bond, starter = 'cute') {
  const value = numeric(bond, 0);
  const stages = stagesForStarter(starter);
  return [...stages].reverse().find((stage) => value >= stage.minBond) || stages[0];
}

export function createSoulmateProfile(input = {}, now = Date.now()) {
  const today = new Date(now).toISOString().slice(0, 10);
  const temperament = temperamentIds.has(input.temperament) ? input.temperament : 'warm';
  const starter = starterIds.has(input.starter) ? input.starter : 'cute';
  const suppliedVoice = voiceIds.has(input.voice) ? input.voice : '';
  const voiceCustomized = input.voiceCustomized === false ? false : Boolean(suppliedVoice);
  const traitSeeds = {
    warm: { warmth: 66, curiosity: 42, steadiness: 54, courage: 40, independence: 34 },
    curious: { warmth: 48, curiosity: 70, steadiness: 38, courage: 52, independence: 42 },
    steady: { warmth: 52, curiosity: 38, steadiness: 72, courage: 48, independence: 44 }
  };
  return {
    version: SOULMATE_PROFILE_VERSION,
    id: `soulmate-${now.toString(36)}`,
    name: cleanText(input.name, 12) || '未命名',
    birthday: cleanDate(input.birthday, today),
    gender: genderIds.has(input.gender) ? input.gender : 'neutral',
    voice: voiceCustomized ? suppliedVoice : defaultVoiceForStarter(starter),
    voiceCustomized,
    starter,
    temperament,
    createdAt: now,
    lastActiveAt: now,
    bond: 0,
    interactions: 0,
    daysTogether: 1,
    traits: traitSeeds[temperament],
    memories: []
  };
}

export function normalizeSoulmateProfile(value, now = Date.now()) {
  if (!value || typeof value !== 'object' || value.version !== SOULMATE_PROFILE_VERSION) return null;
  const createdAt = numeric(value.createdAt, now, 0, now);
  const daysTogether = Math.max(1, Math.floor((now - createdAt) / 86400000) + 1);
  const base = createSoulmateProfile({
    ...value,
    // Profiles written before this marker used the wrong generic default.
    voiceCustomized: value.voiceCustomized === true
  }, createdAt);
  return {
    ...base,
    id: cleanText(value.id, 64) || base.id,
    lastActiveAt: numeric(value.lastActiveAt, now, createdAt, now),
    bond: numeric(value.bond, 0, 0, 9999),
    interactions: numeric(value.interactions, 0, 0, 999999),
    daysTogether,
    traits: {
      warmth: numeric(value.traits?.warmth, base.traits.warmth, 0, 100),
      curiosity: numeric(value.traits?.curiosity, base.traits.curiosity, 0, 100),
      steadiness: numeric(value.traits?.steadiness, base.traits.steadiness, 0, 100),
      courage: numeric(value.traits?.courage, base.traits.courage, 0, 100),
      independence: numeric(value.traits?.independence, base.traits.independence, 0, 100)
    },
    memories: normalizeSoulmateMemories(value.memories, now)
  };
}

export function normalizeSoulmateHistory(value) {
  if (!Array.isArray(value)) return [];
  return value.map((message) => {
    const role = message?.role === 'assistant' ? 'assistant' : message?.role === 'user' ? 'user' : '';
    const content = cleanText(message?.content, 300);
    return role && content ? { role, content } : null;
  }).filter(Boolean).slice(-12);
}

export function createSoulmateExportBundle(profile, history, now = Date.now()) {
  const normalizedProfile = normalizeSoulmateProfile(profile, now);
  if (!normalizedProfile) return null;
  return {
    format: 'nexora-core-companion',
    version: SOULMATE_EXPORT_VERSION,
    exportedAt: new Date(now).toISOString(),
    profile: normalizedProfile,
    history: normalizeSoulmateHistory(history)
  };
}

export function normalizeSoulmateExportBundle(value, now = Date.now()) {
  if (!value || typeof value !== 'object') return null;
  if (value.format && value.format !== 'nexora-core-companion') return null;
  if (value.version !== undefined && value.version !== SOULMATE_EXPORT_VERSION) return null;
  const profile = normalizeSoulmateProfile(value.profile, now);
  if (!profile) return null;
  return { profile, history: normalizeSoulmateHistory(value.history) };
}

export function growSoulmate(profile, interaction = {}, now = Date.now()) {
  const current = normalizeSoulmateProfile(profile, now);
  if (!current) return null;
  const kind = ['chat', 'touch', 'care', 'device'].includes(interaction.kind) ? interaction.kind : 'touch';
  const gain = { chat: 8, touch: 2, care: 5, device: 3 }[kind];
  const next = structuredClone(current);
  next.bond = Math.min(9999, next.bond + gain);
  next.interactions += 1;
  next.lastActiveAt = now;
  const text = cleanText(interaction.text, 120);
  if (kind === 'chat' && text) {
    next.memories = rememberSoulmateInteraction(next.memories, text, now);
    if (/[?？为什么怎么想知道]/.test(text)) next.traits.curiosity = Math.min(100, next.traits.curiosity + 1);
    if (/[谢谢喜欢爱想你抱]/.test(text)) next.traits.warmth = Math.min(100, next.traits.warmth + 1);
    if (/[难过压力累害怕担心]/.test(text)) next.traits.steadiness = Math.min(100, next.traits.steadiness + 1);
  }
  return next;
}

export function stageProgress(profile) {
  const stage = stageForBond(profile?.bond || 0, profile?.starter);
  if (!stage.nextBond) return { stage, progress: 1, remaining: 0 };
  const span = stage.nextBond - stage.minBond;
  const progress = Math.max(0, Math.min(1, ((profile?.bond || 0) - stage.minBond) / span));
  return { stage, progress, remaining: Math.max(0, stage.nextBond - (profile?.bond || 0)) };
}

export function soulmatePromptProfile(profile, query = '') {
  const current = normalizeSoulmateProfile(profile);
  if (!current) return null;
  const stage = stageForBond(current.bond, current.starter);
  const starter = soulmateStarterCatalog[current.starter] || soulmateStarterCatalog.cute;
  return {
    name: current.name,
    birthday: current.birthday,
    gender: current.gender,
    temperament: current.temperament,
    starterId: current.starter,
    starter: starter.name,
    species: starter.species,
    stage: stage.name,
    daysTogether: current.daysTogether,
    traits: current.traits,
    memories: recallSoulmateMemories(current.memories, query, 6).map((memory) => memory.summary)
  };
}
