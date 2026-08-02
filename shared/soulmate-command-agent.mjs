import {
  createDeviceCommandAgentCredential,
  encryptDeviceCommandForAgent,
  formatDeviceCommandPairingCode,
  normalizeDeviceCommandAgentCredential
} from './device-command-cloud.mjs';
import { fromBase64Url, toBase64Url } from './device-cloud-crypto.mjs';
import { createSoulmateDeviceCloudStorage } from './soulmate-device-cloud.mjs';
import { normalizeSoulmateCloudIdentity } from './soulmate-cloud-sync.mjs';

const stateVersion = 1;
const storagePrefix = 'command-agent:';

function cryptoApi(value = globalThis.crypto) {
  if (!value?.getRandomValues || !value?.subtle) throw new Error('secure crypto unavailable');
  return value;
}

function storageKey(identity) {
  return `${storagePrefix}${identity.syncId}`;
}

async function stateKey(identity, usages, crypto) {
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
    salt: new TextEncoder().encode('nexora-command-agent-storage-v1'),
    info: new TextEncoder().encode(identity.syncId)
  }, material, { name: 'AES-GCM', length: 256 }, false, usages);
}

async function requestJson(fetchImpl, path, options = {}) {
  const response = await fetchImpl(path, {
    credentials: 'same-origin',
    cache: 'no-store',
    ...options,
    headers: { 'Accept': 'application/json', 'Content-Type': 'application/json', ...(options.headers || {}) }
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(String(body.message || body.error || 'command cloud unavailable'));
    error.status = response.status;
    error.code = String(body.error || 'request_failed');
    throw error;
  }
  return body;
}

export async function saveSoulmateCommandAgent(identityValue, credentialValue, options = {}) {
  const identity = normalizeSoulmateCloudIdentity(identityValue);
  const credential = normalizeDeviceCommandAgentCredential(credentialValue);
  if (!identity || !credential || credential.vaultId !== identity.syncId) {
    throw new Error('invalid command agent');
  }
  const crypto = cryptoApi(options.crypto);
  const storage = options.storage || createSoulmateDeviceCloudStorage(options.indexedDb);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await stateKey(identity, ['encrypt'], crypto);
  const ciphertext = await crypto.subtle.encrypt({
    name: 'AES-GCM',
    iv,
    additionalData: new TextEncoder().encode(`nexora-command-agent-state-v1:${identity.syncId}`),
    tagLength: 128
  }, key, new TextEncoder().encode(JSON.stringify(credential)));
  await storage.put(storageKey(identity), {
    version: stateVersion,
    vaultId: identity.syncId,
    iv: toBase64Url(iv),
    ciphertext: toBase64Url(ciphertext)
  });
  return credential;
}

export async function loadSoulmateCommandAgent(identityValue, options = {}) {
  const identity = normalizeSoulmateCloudIdentity(identityValue);
  if (!identity) return null;
  const crypto = cryptoApi(options.crypto);
  const storage = options.storage || createSoulmateDeviceCloudStorage(options.indexedDb);
  const envelope = await storage.get(storageKey(identity));
  if (!envelope || envelope.version !== stateVersion || envelope.vaultId !== identity.syncId) return null;
  try {
    const key = await stateKey(identity, ['decrypt'], crypto);
    const plaintext = await crypto.subtle.decrypt({
      name: 'AES-GCM',
      iv: fromBase64Url(envelope.iv, 12, 12),
      additionalData: new TextEncoder().encode(`nexora-command-agent-state-v1:${identity.syncId}`),
      tagLength: 128
    }, key, fromBase64Url(envelope.ciphertext, 17, 4096));
    const credential = normalizeDeviceCommandAgentCredential(JSON.parse(new TextDecoder().decode(plaintext)));
    return credential?.vaultId === identity.syncId ? credential : null;
  } catch (error) {
    return null;
  }
}

export async function registerSoulmateCommandAgent(identityValue, options = {}) {
  const identity = normalizeSoulmateCloudIdentity(identityValue);
  if (!identity) throw new Error('cloud sync is required');
  const created = await createDeviceCommandAgentCredential(identity.syncId, {
    displayName: options.displayName || 'NEXORA Desktop',
    crypto: options.crypto
  });
  await requestJson(options.fetchImpl || globalThis.fetch, '/api/device-cloud/command-agents', {
    method: 'POST',
    body: JSON.stringify(created.registration)
  });
  await saveSoulmateCommandAgent(identity, created.credential, options);
  return created;
}

export async function getSoulmateCommandAgentStatus(identityValue, credentialValue, options = {}) {
  const identity = normalizeSoulmateCloudIdentity(identityValue);
  const credential = normalizeDeviceCommandAgentCredential(credentialValue);
  if (!identity || !credential || identity.syncId !== credential.vaultId) return null;
  return requestJson(
    options.fetchImpl || globalThis.fetch,
    `/api/device-cloud/command-agents/${encodeURIComponent(credential.agentId)}?vaultId=${encodeURIComponent(identity.syncId)}`
  );
}

export async function queueSoulmateDeviceCommand(command, identityValue, credentialValue, options = {}) {
  const identity = normalizeSoulmateCloudIdentity(identityValue);
  const credential = normalizeDeviceCommandAgentCredential(credentialValue);
  if (!identity || !credential || identity.syncId !== credential.vaultId) {
    throw new Error('command agent is not paired');
  }
  const envelope = await encryptDeviceCommandForAgent(command, credential, {
    crypto: options.crypto,
    expiresInSeconds: options.expiresInSeconds
  });
  return requestJson(options.fetchImpl || globalThis.fetch, '/api/device-cloud/commands', {
    method: 'POST',
    body: JSON.stringify(envelope)
  });
}

export async function getSoulmateDeviceCommandStatus(commandId, options = {}) {
  return requestJson(
    options.fetchImpl || globalThis.fetch,
    `/api/device-cloud/commands/${encodeURIComponent(String(commandId || ''))}`
  );
}

export function soulmateCommandAgentPairingCode(value) {
  return formatDeviceCommandPairingCode(value);
}
