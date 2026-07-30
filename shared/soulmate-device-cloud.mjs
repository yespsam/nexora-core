import {
  createDeviceCloudKeys,
  createRecoveryEnvelope,
  fromBase64Url,
  toBase64Url,
  wrapVaultKeyForDevice
} from './device-cloud-crypto.mjs';
import {
  canonicalDeviceCloudEvent,
  normalizeDeviceCloudEvent
} from './device-cloud-protocol.mjs';
import {
  SOULMATE_CLOUD_SYNC_DB_NAME,
  normalizeSoulmateCloudIdentity
} from './soulmate-cloud-sync.mjs';
import { normalizeSoulmateExportBundle } from './soulmate-profile.mjs';

export const SOULMATE_DUAL_WRITE_STATE_VERSION = 1;

const deviceStoreName = 'cloud-sync';
const stateKeyPrefix = 'device-cloud:';
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const base64Url32Pattern = /^[A-Za-z0-9_-]{43}$/;

function cryptoApi(value = globalThis.crypto) {
  if (!value?.getRandomValues || !value?.randomUUID || !value?.subtle) {
    throw new Error('secure crypto unavailable');
  }
  return value;
}

function jsonHeaders() {
  return { 'Accept': 'application/json', 'Content-Type': 'application/json' };
}

async function responseJson(response) {
  try {
    return await response.json();
  } catch (error) {
    return {};
  }
}

async function requestJson(fetchImpl, url, options = {}) {
  const response = await fetchImpl(url, {
    credentials: 'same-origin',
    ...options,
    headers: { ...jsonHeaders(), ...(options.headers || {}) }
  });
  return { response, body: await responseJson(response) };
}

function openDatabase(indexedDb = globalThis.indexedDB) {
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

async function withStore(mode, operation, indexedDb) {
  const database = await openDatabase(indexedDb);
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(deviceStoreName, mode);
      const request = operation(transaction.objectStore(deviceStoreName));
      let result;
      request.onsuccess = () => { result = request.result; };
      request.onerror = () => reject(new Error('private device storage unavailable'));
      transaction.oncomplete = () => resolve(result);
      transaction.onerror = () => reject(new Error('private device storage unavailable'));
      transaction.onabort = () => reject(new Error('private device storage unavailable'));
    });
  } finally {
    database.close();
  }
}

export function createSoulmateDeviceCloudStorage(indexedDb = globalThis.indexedDB) {
  return {
    get(key) {
      return withStore('readonly', (store) => store.get(key), indexedDb);
    },
    put(key, value) {
      return withStore('readwrite', (store) => store.put(value, key), indexedDb);
    },
    delete(key) {
      return withStore('readwrite', (store) => store.delete(key), indexedDb);
    }
  };
}

function stateKey(identity) {
  return `${stateKeyPrefix}${identity.syncId}`;
}

async function deriveKey(identity, purpose, usages, extractable, crypto) {
  const material = await crypto.subtle.importKey(
    'raw',
    fromBase64Url(identity.encryptionKey, 32, 32),
    'HKDF',
    false,
    ['deriveKey']
  );
  return crypto.subtle.deriveKey({
    name: 'HKDF',
    hash: 'SHA-256',
    salt: new TextEncoder().encode('nexora-core-device-cloud-v1'),
    info: new TextEncoder().encode(`${purpose}:${identity.syncId}`)
  }, material, { name: 'AES-GCM', length: 256 }, extractable, usages);
}

function privateP256Jwk(value) {
  if (
    !value
    || value.kty !== 'EC'
    || value.crv !== 'P-256'
    || !base64Url32Pattern.test(String(value.x || ''))
    || !base64Url32Pattern.test(String(value.y || ''))
    || !base64Url32Pattern.test(String(value.d || ''))
  ) return null;
  return {
    kty: 'EC',
    crv: 'P-256',
    x: value.x,
    y: value.y,
    d: value.d,
    ext: true
  };
}

function publicP256Jwk(value) {
  const key = privateP256Jwk(value);
  return key ? { kty: key.kty, crv: key.crv, x: key.x, y: key.y } : null;
}

function normalizeState(value, syncId) {
  if (!value || value.version !== SOULMATE_DUAL_WRITE_STATE_VERSION || value.syncId !== syncId) return null;
  const signingPrivateJwk = privateP256Jwk(value.signingPrivateJwk);
  const exchangePrivateJwk = privateP256Jwk(value.exchangePrivateJwk);
  const deviceSequence = Number(value.deviceSequence);
  const previousEventHash = String(value.previousEventHash || '');
  const pendingEvent = value.pendingEvent ? normalizeDeviceCloudEvent(value.pendingEvent) : null;
  const pendingRevision = Number(value.pendingRevision || 0);
  if (!uuidPattern.test(String(value.deviceId || '')) || !signingPrivateJwk || !exchangePrivateJwk) return null;
  if (!Number.isSafeInteger(deviceSequence) || deviceSequence < 0) return null;
  if (deviceSequence === 0 && previousEventHash) return null;
  if (deviceSequence > 0 && !base64Url32Pattern.test(previousEventHash)) return null;
  if (value.pendingEvent && (!pendingEvent || !Number.isSafeInteger(pendingRevision) || pendingRevision < 1)) return null;
  return {
    version: SOULMATE_DUAL_WRITE_STATE_VERSION,
    syncId,
    deviceId: String(value.deviceId).toLowerCase(),
    signingPrivateJwk,
    exchangePrivateJwk,
    registered: value.registered === true,
    deviceSequence,
    previousEventHash,
    lastMirroredRevision: Math.max(0, Math.floor(Number(value.lastMirroredRevision) || 0)),
    lastVerifiedRevision: Math.max(0, Math.floor(Number(value.lastVerifiedRevision) || 0)),
    latestCursor: Math.max(0, Math.floor(Number(value.latestCursor) || 0)),
    lastEventId: uuidPattern.test(String(value.lastEventId || '')) ? String(value.lastEventId).toLowerCase() : '',
    pendingEvent,
    pendingRevision: pendingEvent ? pendingRevision : 0
  };
}

async function encryptState(state, identity, crypto) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(identity, 'local-state', ['encrypt'], false, crypto);
  const ciphertext = await crypto.subtle.encrypt({
    name: 'AES-GCM',
    iv,
    additionalData: new TextEncoder().encode(`nexora-device-state-v1:${identity.syncId}`),
    tagLength: 128
  }, key, new TextEncoder().encode(JSON.stringify(state)));
  return {
    version: SOULMATE_DUAL_WRITE_STATE_VERSION,
    syncId: identity.syncId,
    iv: toBase64Url(iv),
    ciphertext: toBase64Url(ciphertext)
  };
}

async function decryptState(envelope, identity, crypto) {
  if (!envelope || envelope.version !== SOULMATE_DUAL_WRITE_STATE_VERSION || envelope.syncId !== identity.syncId) {
    return null;
  }
  try {
    const key = await deriveKey(identity, 'local-state', ['decrypt'], false, crypto);
    const plaintext = await crypto.subtle.decrypt({
      name: 'AES-GCM',
      iv: fromBase64Url(envelope.iv, 12, 12),
      additionalData: new TextEncoder().encode(`nexora-device-state-v1:${identity.syncId}`),
      tagLength: 128
    }, key, fromBase64Url(envelope.ciphertext, 17, 65536));
    return normalizeState(JSON.parse(new TextDecoder().decode(plaintext)), identity.syncId);
  } catch (error) {
    return null;
  }
}

async function loadState(identity, storage, crypto) {
  return decryptState(await storage.get(stateKey(identity)), identity, crypto);
}

async function saveState(state, identity, storage, crypto) {
  await storage.put(stateKey(identity), await encryptState(state, identity, crypto));
}

async function createState(identity, crypto) {
  const keys = await createDeviceCloudKeys(crypto);
  return normalizeState({
    version: SOULMATE_DUAL_WRITE_STATE_VERSION,
    syncId: identity.syncId,
    deviceId: crypto.randomUUID(),
    signingPrivateJwk: await crypto.subtle.exportKey('jwk', keys.signing.privateKey),
    exchangePrivateJwk: await crypto.subtle.exportKey('jwk', keys.exchange.privateKey),
    registered: false,
    deviceSequence: 0,
    previousEventHash: '',
    lastMirroredRevision: 0,
    lastVerifiedRevision: 0,
    latestCursor: 0,
    lastEventId: '',
    pendingEvent: null,
    pendingRevision: 0
  }, identity.syncId);
}

function registration(state, wrappedVaultKey) {
  return {
    id: state.deviceId,
    type: 'phone',
    displayName: 'NEXORA Web Phone',
    signingKeyId: `device:${state.deviceId}`,
    signingPublicJwk: publicP256Jwk(state.signingPrivateJwk),
    exchangePublicJwk: publicP256Jwk(state.exchangePrivateJwk),
    firmwareVersion: 'web-dual-write-1',
    wrappedVaultKey
  };
}

async function ensureRegistered(state, identity, vaultKey, fetchImpl, storage, crypto) {
  if (state.registered) return state;
  const wrappedVaultKey = await wrapVaultKeyForDevice(
    vaultKey,
    publicP256Jwk(state.exchangePrivateJwk),
    crypto
  );
  const recovery = await createRecoveryEnvelope(
    vaultKey,
    fromBase64Url(identity.encryptionKey, 32, 32),
    crypto
  );
  const bootstrap = await requestJson(fetchImpl, '/api/device-cloud/bootstrap', {
    method: 'POST',
    body: JSON.stringify({
      vaultId: identity.syncId,
      region: 'test',
      device: registration(state, wrappedVaultKey),
      recovery: {
        recoveryKeyId: recovery.recoveryKeyId,
        wrappedVaultKey: recovery.wrappedVaultKey
      }
    })
  });
  if (!bootstrap.response.ok && bootstrap.response.status !== 409) throw new Error('device bootstrap unavailable');
  if (bootstrap.response.status === 409) {
    const registered = await requestJson(fetchImpl, '/api/device-cloud/devices', {
      method: 'POST',
      body: JSON.stringify({
        vaultId: identity.syncId,
        device: registration(state, wrappedVaultKey)
      })
    });
    // A retry after a lost bootstrap response can find this exact device already registered.
    if (!registered.response.ok && registered.response.status !== 409) {
      throw new Error('device registration unavailable');
    }
  }
  const next = { ...state, registered: true };
  await saveState(next, identity, storage, crypto);
  return next;
}

async function digestBundle(bundle, crypto) {
  return toBase64Url(await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(JSON.stringify(bundle))
  ));
}

async function createMirrorEvent(state, identity, bundle, revision, vaultKey, crypto) {
  const bundleDigest = await digestBundle(bundle, crypto);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({
    name: 'AES-GCM',
    iv,
    additionalData: new TextEncoder().encode(`nexora-device-event-v1:${identity.syncId}`),
    tagLength: 128
  }, vaultKey, new TextEncoder().encode(JSON.stringify({
    version: 1,
    type: 'migration.snapshot.v1',
    sourceRevision: revision,
    bundleDigest,
    bundle
  })));
  const event = {
    version: 1,
    eventId: crypto.randomUUID(),
    vaultId: identity.syncId,
    deviceId: state.deviceId,
    deviceSequence: state.deviceSequence + 1,
    occurredAt: new Date().toISOString(),
    keyVersion: 1,
    previousEventHash: state.previousEventHash,
    payload: {
      algorithm: 'A256GCM',
      iv: toBase64Url(iv),
      ciphertext: toBase64Url(ciphertext)
    },
    auth: {
      algorithm: 'ES256',
      keyId: `device:${state.deviceId}`,
      signature: 'A'.repeat(86)
    }
  };
  const signingKey = await crypto.subtle.importKey(
    'jwk',
    state.signingPrivateJwk,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    signingKey,
    new TextEncoder().encode(canonicalDeviceCloudEvent(event))
  );
  event.auth.signature = toBase64Url(signature);
  if (!normalizeDeviceCloudEvent(event)) throw new Error('invalid mirrored event');
  return event;
}

async function decryptMirrorPayload(event, identity, vaultKey, crypto) {
  const plaintext = await crypto.subtle.decrypt({
    name: 'AES-GCM',
    iv: fromBase64Url(event.payload?.iv, 12, 12),
    additionalData: new TextEncoder().encode(`nexora-device-event-v1:${identity.syncId}`),
    tagLength: 128
  }, vaultKey, fromBase64Url(event.payload?.ciphertext, 17, 262144));
  return new TextDecoder().decode(plaintext);
}

async function verifyCommittedEvent(state, identity, revision, expectedEvent, vaultKey, fetchImpl, crypto) {
  try {
    const after = Math.max(0, state.latestCursor - 1);
    const result = await requestJson(
      fetchImpl,
      `/api/device-cloud/events?vaultId=${encodeURIComponent(identity.syncId)}&deviceId=${encodeURIComponent(state.deviceId)}&after=${after}&limit=2`,
      { method: 'GET' }
    );
    if (!result.response.ok || !Array.isArray(result.body.events)) return false;
    const saved = result.body.events.find((event) => event.eventId === state.lastEventId);
    if (!saved) return false;
    const savedEvent = normalizeDeviceCloudEvent(saved);
    const expectedCanonical = canonicalDeviceCloudEvent(expectedEvent);
    if (!savedEvent || canonicalDeviceCloudEvent(savedEvent) !== expectedCanonical) return false;
    const expectedHash = toBase64Url(await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(expectedCanonical)
    ));
    if (saved.contentHash !== expectedHash || state.previousEventHash !== expectedHash) return false;
    const [savedPlaintext, expectedPlaintext] = await Promise.all([
      decryptMirrorPayload(savedEvent, identity, vaultKey, crypto),
      decryptMirrorPayload(expectedEvent, identity, vaultKey, crypto)
    ]);
    if (savedPlaintext !== expectedPlaintext) return false;
    const value = JSON.parse(savedPlaintext);
    const normalizedBundle = normalizeSoulmateExportBundle(value?.bundle);
    return value?.version === 1
      && value?.type === 'migration.snapshot.v1'
      && value?.sourceRevision === revision
      && Boolean(normalizedBundle)
      && value?.bundleDigest === await digestBundle(normalizedBundle, crypto);
  } catch (error) {
    return false;
  }
}

async function flushPending(state, identity, vaultKey, fetchImpl, storage, crypto) {
  if (!state.pendingEvent) return { state, report: null };
  const expectedEvent = state.pendingEvent;
  const expectedRevision = state.pendingRevision;
  const saved = await requestJson(fetchImpl, '/api/device-cloud/events', {
    method: 'POST',
    body: JSON.stringify(expectedEvent)
  });
  const contentHash = String(saved.body.contentHash || '');
  if (!saved.response.ok || !base64Url32Pattern.test(contentHash)) {
    throw new Error('event mirror unavailable');
  }
  let next = {
    ...state,
    deviceSequence: expectedEvent.deviceSequence,
    previousEventHash: contentHash,
    lastMirroredRevision: expectedRevision,
    latestCursor: Math.max(1, Math.floor(Number(saved.body.cursor) || 0)),
    lastEventId: expectedEvent.eventId,
    pendingEvent: null,
    pendingRevision: 0
  };
  await saveState(next, identity, storage, crypto);
  const verified = await verifyCommittedEvent(
    next,
    identity,
    next.lastMirroredRevision,
    expectedEvent,
    vaultKey,
    fetchImpl,
    crypto
  );
  if (verified) {
    next = { ...next, lastVerifiedRevision: next.lastMirroredRevision };
    await saveState(next, identity, storage, crypto);
  }
  return {
    state: next,
    report: {
      enabled: true,
      mirrored: true,
      verified,
      sourceRevision: next.lastMirroredRevision,
      cursor: next.latestCursor
    }
  };
}

async function deviceCloudStatus(fetchImpl) {
  try {
    const result = await requestJson(fetchImpl, '/api/device-cloud/status', { method: 'GET' });
    return {
      enabled: result.response.ok && result.body.enabled === true,
      dualWrite: result.response.ok && result.body.dualWrite === true
    };
  } catch (error) {
    return { enabled: false, dualWrite: false };
  }
}

export async function mirrorSoulmateCloudState(bundleValue, identityValue, sourceRevisionValue, options = {}) {
  const identity = normalizeSoulmateCloudIdentity(identityValue);
  const bundle = normalizeSoulmateExportBundle(bundleValue);
  const sourceRevision = Math.floor(Number(sourceRevisionValue) || 0);
  if (!identity || !bundle || sourceRevision < 1) {
    return { enabled: false, mirrored: false, verified: false, reason: 'invalid' };
  }
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const remoteStatus = await deviceCloudStatus(fetchImpl);
  if (!remoteStatus.dualWrite) {
    return { enabled: false, mirrored: false, verified: false, reason: 'disabled' };
  }
  try {
    const crypto = cryptoApi(options.crypto || globalThis.crypto);
    const storage = options.storage || createSoulmateDeviceCloudStorage(options.indexedDb);
    const vaultKey = await deriveKey(identity, 'vault', ['encrypt', 'decrypt'], true, crypto);
    let state = await loadState(identity, storage, crypto);
    if (!state) {
      state = await createState(identity, crypto);
      // Persist keys before the first network write so a committed bootstrap can be retried safely.
      await saveState(state, identity, storage, crypto);
    }
    state = await ensureRegistered(state, identity, vaultKey, fetchImpl, storage, crypto);
    if (state.pendingEvent) {
      const flushed = await flushPending(
        state,
        identity,
        vaultKey,
        fetchImpl,
        storage,
        crypto
      );
      state = flushed.state;
      if (sourceRevision <= state.lastMirroredRevision) return flushed.report;
    }
    if (sourceRevision <= state.lastMirroredRevision) {
      return {
        enabled: true,
        mirrored: false,
        verified: state.lastVerifiedRevision >= sourceRevision,
        reason: 'current',
        sourceRevision,
        cursor: state.latestCursor
      };
    }
    const pendingEvent = await createMirrorEvent(state, identity, bundle, sourceRevision, vaultKey, crypto);
    state = { ...state, pendingEvent, pendingRevision: sourceRevision };
    await saveState(state, identity, storage, crypto);
    return (await flushPending(
      state,
      identity,
      vaultKey,
      fetchImpl,
      storage,
      crypto
    )).report;
  } catch (error) {
    return { enabled: true, mirrored: false, verified: false, reason: 'unavailable' };
  }
}

export async function getSoulmateDeviceCloudDiagnostic(identityValue, options = {}) {
  const identity = normalizeSoulmateCloudIdentity(identityValue);
  if (!identity) return null;
  try {
    const crypto = cryptoApi(options.crypto || globalThis.crypto);
    const storage = options.storage || createSoulmateDeviceCloudStorage(options.indexedDb);
    const state = await loadState(identity, storage, crypto);
    if (!state) {
      return {
        registered: false,
        mirroredRevision: 0,
        verifiedRevision: 0,
        cursor: 0,
        pending: false
      };
    }
    return {
      registered: state.registered,
      mirroredRevision: state.lastMirroredRevision,
      verifiedRevision: state.lastVerifiedRevision,
      cursor: state.latestCursor,
      pending: Boolean(state.pendingEvent)
    };
  } catch (error) {
    return null;
  }
}

export async function requestSoulmateDeviceCloudDeletion(identityValue, options = {}) {
  const identity = normalizeSoulmateCloudIdentity(identityValue);
  if (!identity) return { enabled: false, scheduled: false, reason: 'invalid' };
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const storage = options.storage || createSoulmateDeviceCloudStorage(options.indexedDb);
  let hasLocalState = false;
  try {
    hasLocalState = Boolean(await storage.get(stateKey(identity)));
  } catch (error) {
    hasLocalState = true;
  }
  const remoteStatus = await deviceCloudStatus(fetchImpl);
  if (!remoteStatus.enabled) {
    return {
      enabled: hasLocalState,
      scheduled: false,
      reason: hasLocalState ? 'unavailable' : 'disabled'
    };
  }
  try {
    const result = await requestJson(fetchImpl, '/api/device-cloud/deletions', {
      method: 'POST',
      body: JSON.stringify({ scope: 'account' })
    });
    if (!result.response.ok) return { enabled: true, scheduled: false, reason: 'unavailable' };
    return { enabled: true, scheduled: true, requestId: String(result.body.requestId || '') };
  } catch (error) {
    return { enabled: true, scheduled: false, reason: 'unavailable' };
  }
}

export async function clearSoulmateDeviceCloudState(identityValue, options = {}) {
  const identity = normalizeSoulmateCloudIdentity(identityValue);
  if (!identity) return false;
  const storage = options.storage || createSoulmateDeviceCloudStorage(options.indexedDb);
  await storage.delete(stateKey(identity));
  return true;
}
