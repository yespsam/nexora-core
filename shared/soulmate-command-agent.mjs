import {
  createDeviceCommandAgentCredential,
  encryptDeviceCommandForAgent,
  formatDeviceCommandPairingCode,
  normalizeDeviceCommandAgentCredential
} from './device-command-cloud.mjs';
import { fromBase64Url, toBase64Url } from './device-cloud-crypto.mjs';
import { createSoulmateDeviceCloudStorage } from './soulmate-device-cloud.mjs';
import { normalizeSoulmateCloudIdentity } from './soulmate-cloud-sync.mjs';

const stateVersion = 2;
const legacyStateVersion = 1;
const maximumStoredAgents = 8;
const storagePrefix = 'command-agent:';
const agentIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function mergeSoulmateCommandAgentStatus(previousValue, nextValue) {
  const previous = previousValue && typeof previousValue === 'object' ? previousValue : {};
  const next = nextValue && typeof nextValue === 'object' ? { ...nextValue } : {};
  const previousSeen = Date.parse(String(previous.lastSeenAt || ''));
  const nextSeen = Date.parse(String(next.lastSeenAt || ''));
  if (Number.isFinite(previousSeen) && (!Number.isFinite(nextSeen) || previousSeen > nextSeen)) {
    next.lastSeenAt = previous.lastSeenAt;
  }
  return next;
}

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

function stateAdditionalData(identity, version) {
  return new TextEncoder().encode(`nexora-command-agent-state-v${version}:${identity.syncId}`);
}

function normalizeAgentState(value, identity, version) {
  const candidates = version === legacyStateVersion ? [value] : value?.credentials;
  const credentials = [];
  const seen = new Set();
  for (const candidate of Array.isArray(candidates) ? candidates : []) {
    const credential = normalizeDeviceCommandAgentCredential(candidate);
    if (
      !credential
      || credential.vaultId !== identity.syncId
      || seen.has(credential.agentId)
    ) continue;
    seen.add(credential.agentId);
    credentials.push(credential);
    if (credentials.length >= maximumStoredAgents) break;
  }
  const requestedSelection = version === stateVersion ? String(value?.selectedAgentId || '') : '';
  const selectedAgentId = credentials.some((item) => item.agentId === requestedSelection)
    ? requestedSelection
    : credentials.at(-1)?.agentId || '';
  return { credentials, selectedAgentId };
}

async function readAgentState(identity, options = {}) {
  const crypto = cryptoApi(options.crypto);
  const storage = options.storage || createSoulmateDeviceCloudStorage(options.indexedDb);
  const envelope = await storage.get(storageKey(identity));
  if (
    !envelope
    || ![legacyStateVersion, stateVersion].includes(envelope.version)
    || envelope.vaultId !== identity.syncId
  ) return { credentials: [], selectedAgentId: '' };
  try {
    const key = await stateKey(identity, ['decrypt'], crypto);
    const plaintext = await crypto.subtle.decrypt({
      name: 'AES-GCM',
      iv: fromBase64Url(envelope.iv, 12, 12),
      additionalData: stateAdditionalData(identity, envelope.version),
      tagLength: 128
    }, key, fromBase64Url(envelope.ciphertext, 17, 8192));
    return normalizeAgentState(
      JSON.parse(new TextDecoder().decode(plaintext)),
      identity,
      envelope.version
    );
  } catch (error) {
    return { credentials: [], selectedAgentId: '' };
  }
}

async function writeAgentState(identity, value, options = {}) {
  const crypto = cryptoApi(options.crypto);
  const storage = options.storage || createSoulmateDeviceCloudStorage(options.indexedDb);
  const normalized = normalizeAgentState(value, identity, stateVersion);
  if (!normalized.credentials.length) {
    await storage.delete(storageKey(identity));
    return normalized;
  }
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await stateKey(identity, ['encrypt'], crypto);
  const ciphertext = await crypto.subtle.encrypt({
    name: 'AES-GCM',
    iv,
    additionalData: stateAdditionalData(identity, stateVersion),
    tagLength: 128
  }, key, new TextEncoder().encode(JSON.stringify(normalized)));
  await storage.put(storageKey(identity), {
    version: stateVersion,
    vaultId: identity.syncId,
    iv: toBase64Url(iv),
    ciphertext: toBase64Url(ciphertext)
  });
  return normalized;
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
  const current = await readAgentState(identity, options);
  const credentials = [
    ...current.credentials.filter((item) => item.agentId !== credential.agentId),
    credential
  ].slice(-maximumStoredAgents);
  await writeAgentState(identity, {
    credentials,
    selectedAgentId: credential.agentId
  }, options);
  return credential;
}

export async function loadSoulmateCommandAgents(identityValue, options = {}) {
  const identity = normalizeSoulmateCloudIdentity(identityValue);
  if (!identity) return [];
  return (await readAgentState(identity, options)).credentials;
}

export async function selectSoulmateCommandAgent(identityValue, agentIdValue, options = {}) {
  const identity = normalizeSoulmateCloudIdentity(identityValue);
  const agentId = String(agentIdValue || '').toLowerCase();
  if (!identity || !agentIdPattern.test(agentId)) return null;
  const current = await readAgentState(identity, options);
  const credential = current.credentials.find((item) => item.agentId === agentId);
  if (!credential) return null;
  await writeAgentState(identity, {
    credentials: current.credentials,
    selectedAgentId: agentId
  }, options);
  return credential;
}

export async function loadSoulmateCommandAgent(identityValue, options = {}) {
  const identity = normalizeSoulmateCloudIdentity(identityValue);
  if (!identity) return null;
  const current = await readAgentState(identity, options);
  return current.credentials.find((item) => item.agentId === current.selectedAgentId) || null;
}

export async function removeSoulmateCommandAgent(identityValue, agentIdValue, options = {}) {
  const identity = normalizeSoulmateCloudIdentity(identityValue);
  const agentId = String(agentIdValue || '').toLowerCase();
  if (!identity || !agentIdPattern.test(agentId)) return false;
  const current = await readAgentState(identity, options);
  const credentials = current.credentials.filter((item) => item.agentId !== agentId);
  await writeAgentState(identity, {
    credentials,
    selectedAgentId: current.selectedAgentId === agentId
      ? credentials.at(-1)?.agentId || ''
      : current.selectedAgentId
  }, options);
  return credentials.length !== current.credentials.length;
}

export async function clearSoulmateCommandAgent(identityValue, options = {}) {
  const identity = normalizeSoulmateCloudIdentity(identityValue);
  if (!identity) return false;
  const storage = options.storage || createSoulmateDeviceCloudStorage(options.indexedDb);
  await storage.delete(storageKey(identity));
  return true;
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

export async function listSoulmateCommandAgentStatuses(identityValue, options = {}) {
  const identity = normalizeSoulmateCloudIdentity(identityValue);
  if (!identity) return [];
  const result = await requestJson(
    options.fetchImpl || globalThis.fetch,
    `/api/device-cloud/command-agents?vaultId=${encodeURIComponent(identity.syncId)}`
  );
  return Array.isArray(result.agents) ? result.agents.slice(0, 20) : [];
}

export async function revokeSoulmateCommandAgentById(identityValue, agentIdValue, options = {}) {
  const identity = normalizeSoulmateCloudIdentity(identityValue);
  const agentId = String(agentIdValue || '').toLowerCase();
  if (!identity || !agentIdPattern.test(agentId)) {
    throw new Error('command agent is not paired');
  }
  const result = await requestJson(
    options.fetchImpl || globalThis.fetch,
    `/api/device-cloud/command-agents/${encodeURIComponent(agentId)}/revoke`,
    {
      method: 'POST',
      body: JSON.stringify({ vaultId: identity.syncId })
    }
  );
  await removeSoulmateCommandAgent(identity, agentId, options);
  return result;
}

export async function revokeSoulmateCommandAgent(identityValue, credentialValue, options = {}) {
  const identity = normalizeSoulmateCloudIdentity(identityValue);
  const credential = normalizeDeviceCommandAgentCredential(credentialValue);
  if (!identity || !credential || identity.syncId !== credential.vaultId) {
    throw new Error('command agent is not paired');
  }
  return revokeSoulmateCommandAgentById(identity, credential.agentId, options);
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
