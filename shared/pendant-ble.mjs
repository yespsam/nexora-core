import { normalizeSoulmateProfile, stageProgress } from './soulmate-profile.mjs';

export const PENDANT_BLE_DEVICE_NAME = 'NEXORA NC-01';
export const PENDANT_BLE_SERVICE_UUID = 'c8a10000-5101-4e58-9a18-8f352dc80101';
export const PENDANT_BLE_SNAPSHOT_UUID = 'c8a10001-5101-4e58-9a18-8f352dc80101';
export const PENDANT_BLE_MAX_BYTES = 384;

const pendantConversationStates = new Set(['affection', 'listening', 'thinking', 'speaking', 'happy']);

export function createPendantBleSnapshot(profile, phase = 'idle') {
  const current = normalizeSoulmateProfile(profile);
  if (!current) return null;
  return {
    v: 1,
    profileId: current.id,
    name: current.name,
    starter: current.starter,
    stage: stageProgress(current).stage.id,
    bond: Math.round(current.bond),
    state: pendantConversationStates.has(phase) ? phase : 'idle'
  };
}

export function encodePendantBleSnapshot(profile, phase = 'idle') {
  const snapshot = createPendantBleSnapshot(profile, phase);
  if (!snapshot) return null;
  const encoded = new TextEncoder().encode(JSON.stringify(snapshot));
  if (encoded.byteLength > PENDANT_BLE_MAX_BYTES) throw new Error('pendant snapshot exceeds BLE contract');
  return encoded;
}
