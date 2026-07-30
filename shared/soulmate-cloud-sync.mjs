import {
  createSoulmateExportBundle,
  normalizeSoulmateExportBundle,
  normalizeSoulmateHistory,
  normalizeSoulmateProfile
} from './soulmate-profile.mjs?v=2';

export const SOULMATE_CLOUD_SYNC_VERSION = 1;
export const SOULMATE_CLOUD_SYNC_DB_NAME = 'nexora-core-private';

const recoveryPrefix = 'NXR1';
const deviceStoreName = 'cloud-sync';
const deviceStateKey = 'active-device';
const syncIdPattern = /^[A-Za-z0-9_-]{22}$/;
const secretPattern = /^[A-Za-z0-9_-]{43}$/;

function cryptoApi(value = globalThis.crypto) {
  if (!value?.getRandomValues || !value?.subtle) throw new Error('secure crypto unavailable');
  return value;
}

function toBase64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const encoded = typeof btoa === 'function'
    ? btoa(binary)
    : Buffer.from(bytes).toString('base64');
  return encoded.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromBase64Url(value) {
  const text = String(value || '');
  const base64 = text.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(text.length / 4) * 4, '=');
  const binary = typeof atob === 'function'
    ? atob(base64)
    : Buffer.from(base64, 'base64').toString('binary');
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function randomSecret(size, crypto = cryptoApi()) {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(size)));
}

export function formatSoulmateRecoveryCode(identity) {
  const normalized = normalizeSoulmateCloudIdentity(identity);
  if (!normalized) return '';
  return `${recoveryPrefix}-${normalized.syncId}.${normalized.encryptionKey}.${normalized.accessToken}`;
}

export function normalizeSoulmateCloudIdentity(value) {
  if (!value || typeof value !== 'object' || value.version !== SOULMATE_CLOUD_SYNC_VERSION) return null;
  const syncId = String(value.syncId || '');
  const encryptionKey = String(value.encryptionKey || '');
  const accessToken = String(value.accessToken || '');
  if (!syncIdPattern.test(syncId) || !secretPattern.test(encryptionKey) || !secretPattern.test(accessToken)) return null;
  return {
    version: SOULMATE_CLOUD_SYNC_VERSION,
    syncId,
    encryptionKey,
    accessToken
  };
}

export function parseSoulmateRecoveryCode(value) {
  const compact = String(value || '').trim().replace(/\s+/g, '');
  const match = compact.match(/^NXR1-([A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]{43})\.([A-Za-z0-9_-]{43})$/);
  if (!match) return null;
  return normalizeSoulmateCloudIdentity({
    version: SOULMATE_CLOUD_SYNC_VERSION,
    syncId: match[1],
    encryptionKey: match[2],
    accessToken: match[3]
  });
}

export function createSoulmateCloudIdentity(crypto = cryptoApi()) {
  const identity = {
    version: SOULMATE_CLOUD_SYNC_VERSION,
    syncId: randomSecret(16, crypto),
    encryptionKey: randomSecret(32, crypto),
    accessToken: randomSecret(32, crypto)
  };
  return { ...identity, recoveryCode: formatSoulmateRecoveryCode(identity) };
}

function openCloudSyncDatabase(indexedDb = globalThis.indexedDB) {
  if (!indexedDb?.open) return Promise.reject(new Error('private device storage unavailable'));
  return new Promise((resolve, reject) => {
    const request = indexedDb.open(SOULMATE_CLOUD_SYNC_DB_NAME, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(deviceStoreName)) database.createObjectStore(deviceStoreName);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('private device storage unavailable'));
  });
}

async function withDeviceStore(mode, operation, indexedDb) {
  const database = await openCloudSyncDatabase(indexedDb);
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(deviceStoreName, mode);
      const store = transaction.objectStore(deviceStoreName);
      const request = operation(store);
      let result;
      request.onsuccess = () => {
        result = request.result;
      };
      request.onerror = () => reject(new Error('private device storage unavailable'));
      transaction.oncomplete = () => resolve(result);
      transaction.onerror = () => reject(new Error('private device storage unavailable'));
      transaction.onabort = () => reject(new Error('private device storage unavailable'));
    });
  } finally {
    database.close();
  }
}

export async function loadSoulmateCloudDeviceState(indexedDb = globalThis.indexedDB) {
  const value = await withDeviceStore('readonly', (store) => store.get(deviceStateKey), indexedDb);
  const identity = normalizeSoulmateCloudIdentity(value?.identity);
  if (!identity) return null;
  return {
    identity,
    revision: Math.max(0, Math.floor(Number(value.revision) || 0))
  };
}

export async function saveSoulmateCloudDeviceState(identityValue, revision = 0, indexedDb = globalThis.indexedDB) {
  const identity = normalizeSoulmateCloudIdentity(identityValue);
  if (!identity) throw new Error('invalid recovery code');
  await withDeviceStore('readwrite', (store) => store.put({
    version: SOULMATE_CLOUD_SYNC_VERSION,
    identity,
    revision: Math.max(0, Math.floor(Number(revision) || 0))
  }, deviceStateKey), indexedDb);
  return true;
}

export async function clearSoulmateCloudDeviceState(indexedDb = globalThis.indexedDB) {
  await withDeviceStore('readwrite', (store) => store.delete(deviceStateKey), indexedDb);
  return true;
}

async function importEncryptionKey(identity, usage, crypto) {
  return crypto.subtle.importKey(
    'raw',
    fromBase64Url(identity.encryptionKey),
    { name: 'AES-GCM' },
    false,
    [usage]
  );
}

function additionalData(syncId) {
  return new TextEncoder().encode(`nexora-core-sync-v${SOULMATE_CLOUD_SYNC_VERSION}:${syncId}`);
}

export async function encryptSoulmateBundle(bundleValue, identityValue, cryptoValue = globalThis.crypto) {
  const crypto = cryptoApi(cryptoValue);
  const identity = normalizeSoulmateCloudIdentity(identityValue);
  const bundle = normalizeSoulmateExportBundle(bundleValue);
  if (!identity || !bundle) throw new Error('invalid sync data');
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await importEncryptionKey(identity, 'encrypt', crypto);
  const plaintext = new TextEncoder().encode(JSON.stringify(bundle));
  const ciphertext = await crypto.subtle.encrypt({
    name: 'AES-GCM',
    iv,
    additionalData: additionalData(identity.syncId),
    tagLength: 128
  }, key, plaintext);
  return {
    version: SOULMATE_CLOUD_SYNC_VERSION,
    algorithm: 'A256GCM',
    iv: toBase64Url(iv),
    ciphertext: toBase64Url(new Uint8Array(ciphertext))
  };
}

export async function decryptSoulmateBundle(payload, identityValue, cryptoValue = globalThis.crypto) {
  const crypto = cryptoApi(cryptoValue);
  const identity = normalizeSoulmateCloudIdentity(identityValue);
  if (!identity || !payload || payload.version !== SOULMATE_CLOUD_SYNC_VERSION || payload.algorithm !== 'A256GCM') {
    throw new Error('invalid encrypted payload');
  }
  const iv = fromBase64Url(payload.iv);
  const ciphertext = fromBase64Url(payload.ciphertext);
  if (iv.byteLength !== 12 || ciphertext.byteLength < 17 || ciphertext.byteLength > 262144) {
    throw new Error('invalid encrypted payload');
  }
  const key = await importEncryptionKey(identity, 'decrypt', crypto);
  let plaintext;
  try {
    plaintext = await crypto.subtle.decrypt({
      name: 'AES-GCM',
      iv,
      additionalData: additionalData(identity.syncId),
      tagLength: 128
    }, key, ciphertext);
  } catch (error) {
    throw new Error('recovery code cannot decrypt this companion');
  }
  const bundle = normalizeSoulmateExportBundle(JSON.parse(new TextDecoder().decode(plaintext)));
  if (!bundle) throw new Error('invalid companion backup');
  return bundle;
}

export function mergeSoulmateSyncBundles(localValue, remoteValue, now = Date.now()) {
  const local = normalizeSoulmateExportBundle(localValue, now);
  const remote = normalizeSoulmateExportBundle(remoteValue, now);
  if (!local) return remote;
  if (!remote) return local;
  if (local.profile.id !== remote.profile.id) return remote;

  const primary = local.profile.lastActiveAt >= remote.profile.lastActiveAt ? local.profile : remote.profile;
  const memories = new Map();
  for (const memory of [...remote.profile.memories, ...local.profile.memories]) {
    const current = memories.get(memory.id);
    if (!current || memory.updatedAt >= current.updatedAt) memories.set(memory.id, memory);
  }
  const profile = normalizeSoulmateProfile({
    ...primary,
    bond: Math.max(local.profile.bond, remote.profile.bond),
    interactions: Math.max(local.profile.interactions, remote.profile.interactions),
    lastActiveAt: Math.max(local.profile.lastActiveAt, remote.profile.lastActiveAt),
    memories: [...memories.values()]
  }, now);
  const messages = [];
  const seen = new Set();
  for (const message of [...remote.history, ...local.history]) {
    const key = `${message.role}:${message.content}`;
    if (seen.has(key)) continue;
    seen.add(key);
    messages.push(message);
  }
  return createSoulmateExportBundle(profile, normalizeSoulmateHistory(messages).slice(-12), now);
}

function syncHeaders(identity) {
  return {
    'Content-Type': 'application/json',
    'X-Nexora-Sync-Token': identity.accessToken
  };
}

async function responseJson(response) {
  try {
    return await response.json();
  } catch (error) {
    return {};
  }
}

export async function downloadSoulmateCloudState(identityValue, fetchImpl = globalThis.fetch) {
  const identity = normalizeSoulmateCloudIdentity(identityValue);
  if (!identity) throw new Error('invalid recovery code');
  const response = await fetchImpl(`/api/sync?id=${encodeURIComponent(identity.syncId)}`, {
    method: 'GET',
    headers: syncHeaders(identity)
  });
  const body = await responseJson(response);
  if (!response.ok) {
    const error = new Error(response.status === 404 ? 'cloud companion not found' : 'cloud sync unavailable');
    error.status = response.status;
    throw error;
  }
  return {
    revision: Math.max(0, Number(body.revision) || 0),
    bundle: await decryptSoulmateBundle(body.payload, identity)
  };
}

export async function uploadSoulmateCloudState(bundle, identityValue, baseRevision = 0, fetchImpl = globalThis.fetch) {
  const identity = normalizeSoulmateCloudIdentity(identityValue);
  if (!identity) throw new Error('invalid recovery code');
  const payload = await encryptSoulmateBundle(bundle, identity);
  const response = await fetchImpl('/api/sync', {
    method: 'PUT',
    headers: syncHeaders(identity),
    body: JSON.stringify({
      id: identity.syncId,
      baseRevision: Math.max(0, Number(baseRevision) || 0),
      payload
    })
  });
  const body = await responseJson(response);
  if (!response.ok) {
    const error = new Error(response.status === 409 ? 'cloud sync conflict' : 'cloud sync unavailable');
    error.status = response.status;
    error.revision = Math.max(0, Number(body.revision) || 0);
    throw error;
  }
  return { revision: Math.max(1, Number(body.revision) || 1) };
}

export async function deleteSoulmateCloudState(identityValue, fetchImpl = globalThis.fetch) {
  const identity = normalizeSoulmateCloudIdentity(identityValue);
  if (!identity) throw new Error('invalid recovery code');
  const response = await fetchImpl(`/api/sync?id=${encodeURIComponent(identity.syncId)}`, {
    method: 'DELETE',
    headers: syncHeaders(identity)
  });
  if (!response.ok && response.status !== 404) throw new Error('cloud sync unavailable');
  return true;
}
