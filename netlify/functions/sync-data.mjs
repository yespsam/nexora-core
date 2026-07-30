import { createHash, timingSafeEqual } from 'node:crypto';

export const SYNC_RECORD_VERSION = 1;
export const SYNC_STORE_NAME = 'nexora-companion-sync-v1';
export const MAX_SYNC_BODY_BYTES = 350000;

const syncIdPattern = /^[A-Za-z0-9_-]{22}$/;
const accessTokenPattern = /^[A-Za-z0-9_-]{43}$/;
const secretPattern = /^[A-Za-z0-9_-]+$/;

export function normalizeSyncId(value) {
  const id = String(value || '');
  return syncIdPattern.test(id) ? id : '';
}

export function normalizeSyncAccessToken(value) {
  const token = String(value || '');
  return accessTokenPattern.test(token) ? token : '';
}

export function normalizeSyncBaseRevision(value) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

export function hashSyncAccessToken(value) {
  const token = normalizeSyncAccessToken(value);
  return token ? createHash('sha256').update(token).digest('hex') : '';
}

export function matchesSyncAccessToken(token, expectedHash) {
  const actual = hashSyncAccessToken(token);
  if (!actual || !/^[a-f0-9]{64}$/.test(String(expectedHash || ''))) return false;
  return timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expectedHash, 'hex'));
}

export function normalizeEncryptedSyncPayload(value) {
  if (!value || typeof value !== 'object') return null;
  if (value.version !== 1 || value.algorithm !== 'A256GCM') return null;
  const iv = String(value.iv || '');
  const ciphertext = String(value.ciphertext || '');
  if (!secretPattern.test(iv) || iv.length !== 16) return null;
  if (!secretPattern.test(ciphertext) || ciphertext.length < 24 || ciphertext.length > 349000) return null;
  return {
    version: 1,
    algorithm: 'A256GCM',
    iv,
    ciphertext
  };
}

export function normalizeSyncRecord(value) {
  if (!value || typeof value !== 'object' || value.version !== SYNC_RECORD_VERSION) return null;
  const tokenHash = /^[a-f0-9]{64}$/.test(String(value.tokenHash || '')) ? String(value.tokenHash) : '';
  const revision = Math.max(0, Math.floor(Number(value.revision) || 0));
  const payload = normalizeEncryptedSyncPayload(value.payload);
  if (!tokenHash || !revision || !payload) return null;
  return {
    version: SYNC_RECORD_VERSION,
    tokenHash,
    revision,
    payload,
    updatedAt: String(value.updatedAt || '').slice(0, 32)
  };
}

export function createSyncRecord({ token, revision, payload, now = new Date() }) {
  const tokenHash = hashSyncAccessToken(token);
  const normalizedPayload = normalizeEncryptedSyncPayload(payload);
  const nextRevision = Math.max(1, Math.floor(Number(revision) || 1));
  if (!tokenHash || !normalizedPayload) return null;
  return {
    version: SYNC_RECORD_VERSION,
    tokenHash,
    revision: nextRevision,
    payload: normalizedPayload,
    updatedAt: now.toISOString()
  };
}
