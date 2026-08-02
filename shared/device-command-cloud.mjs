import { fromBase64Url, toBase64Url } from './device-cloud-crypto.mjs';
import { normalizeDeviceCommand } from './device-command.mjs';

export const DEVICE_COMMAND_CLOUD_VERSION = 1;
export const DEVICE_COMMAND_PAIRING_PREFIX = 'NXC1';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const vaultIdPattern = /^[A-Za-z0-9_-]{22}$/;
const hashPattern = /^[A-Za-z0-9_-]{43}$/;
const maximumCiphertextBytes = 16384;

function cryptoApi(value = globalThis.crypto) {
  if (!value?.getRandomValues || !value?.randomUUID || !value?.subtle) {
    throw new Error('secure crypto unavailable');
  }
  return value;
}

function validAgentId(value) {
  const text = String(value || '').toLowerCase();
  return uuidPattern.test(text) ? text : '';
}

function validVaultId(value) {
  const text = String(value || '');
  return vaultIdPattern.test(text) ? text : '';
}

function pairingAdditionalData(agentId, vaultId) {
  return new TextEncoder().encode(`nexora-device-command-v1:${agentId}:${vaultId}`);
}

async function commandKey(secret, agentId, vaultId, usages, crypto) {
  const material = await crypto.subtle.importKey(
    'raw',
    fromBase64Url(secret, 32, 32),
    'HKDF',
    false,
    ['deriveKey']
  );
  return crypto.subtle.deriveKey({
    name: 'HKDF',
    hash: 'SHA-256',
    salt: new TextEncoder().encode('nexora-device-command-agent-v1'),
    info: pairingAdditionalData(agentId, vaultId)
  }, material, { name: 'AES-GCM', length: 256 }, false, usages);
}

export function normalizeDeviceCommandAgentCredential(value) {
  if (!value || value.version !== DEVICE_COMMAND_CLOUD_VERSION) return null;
  const agentId = validAgentId(value.agentId);
  const vaultId = validVaultId(value.vaultId);
  const secret = String(value.secret || '');
  const displayName = String(value.displayName || 'NEXORA Desktop').trim().slice(0, 80);
  if (!agentId || !vaultId || !hashPattern.test(secret) || !displayName) return null;
  return { version: DEVICE_COMMAND_CLOUD_VERSION, agentId, vaultId, secret, displayName };
}

export function formatDeviceCommandPairingCode(value) {
  const credential = normalizeDeviceCommandAgentCredential(value);
  return credential
    ? [DEVICE_COMMAND_PAIRING_PREFIX, credential.agentId, credential.vaultId, credential.secret].join('.')
    : '';
}

export function parseDeviceCommandPairingCode(value) {
  const [prefix, agentId, vaultId, secret, extra] = String(value || '').trim().split('.');
  if (prefix !== DEVICE_COMMAND_PAIRING_PREFIX || extra !== undefined) return null;
  return normalizeDeviceCommandAgentCredential({
    version: DEVICE_COMMAND_CLOUD_VERSION,
    agentId,
    vaultId,
    secret,
    displayName: 'NEXORA Desktop'
  });
}

export async function createDeviceCommandAgentCredential(vaultIdValue, options = {}) {
  const crypto = cryptoApi(options.crypto);
  const vaultId = validVaultId(vaultIdValue);
  if (!vaultId) throw new Error('invalid vault id');
  const secretBytes = crypto.getRandomValues(new Uint8Array(32));
  const secret = toBase64Url(secretBytes);
  const credentialHash = toBase64Url(await crypto.subtle.digest('SHA-256', secretBytes));
  const credential = normalizeDeviceCommandAgentCredential({
    version: DEVICE_COMMAND_CLOUD_VERSION,
    agentId: crypto.randomUUID(),
    vaultId,
    secret,
    displayName: options.displayName || 'NEXORA Desktop'
  });
  if (!credential) throw new Error('could not create command agent');
  return {
    credential,
    registration: {
      version: DEVICE_COMMAND_CLOUD_VERSION,
      agentId: credential.agentId,
      vaultId: credential.vaultId,
      displayName: credential.displayName,
      credentialHash
    },
    pairingCode: formatDeviceCommandPairingCode(credential)
  };
}

export function normalizeEncryptedDeviceCommand(value) {
  if (!value || value.version !== DEVICE_COMMAND_CLOUD_VERSION) return null;
  const agentId = validAgentId(value.agentId);
  const vaultId = validVaultId(value.vaultId);
  const keyVersion = Number(value.keyVersion);
  const expiresInSeconds = Number(value.expiresInSeconds);
  const iv = String(value.payload?.iv || '');
  const ciphertext = String(value.payload?.ciphertext || '');
  if (!agentId || !vaultId || keyVersion !== 1) return null;
  if (!Number.isInteger(expiresInSeconds) || expiresInSeconds < 30 || expiresInSeconds > 300) return null;
  if (value.payload?.algorithm !== 'A256GCM') return null;
  try {
    fromBase64Url(iv, 12, 12);
    fromBase64Url(ciphertext, 17, maximumCiphertextBytes);
  } catch (error) {
    return null;
  }
  return {
    version: DEVICE_COMMAND_CLOUD_VERSION,
    agentId,
    vaultId,
    keyVersion,
    expiresInSeconds,
    payload: { algorithm: 'A256GCM', iv, ciphertext }
  };
}

export async function encryptDeviceCommandForAgent(commandValue, credentialValue, options = {}) {
  const crypto = cryptoApi(options.crypto);
  const command = normalizeDeviceCommand(commandValue);
  const credential = normalizeDeviceCommandAgentCredential(credentialValue);
  if (!command || !credential) throw new Error('invalid device command');
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await commandKey(
    credential.secret,
    credential.agentId,
    credential.vaultId,
    ['encrypt'],
    crypto
  );
  const ciphertext = await crypto.subtle.encrypt({
    name: 'AES-GCM',
    iv,
    additionalData: pairingAdditionalData(credential.agentId, credential.vaultId),
    tagLength: 128
  }, key, new TextEncoder().encode(JSON.stringify(command)));
  return normalizeEncryptedDeviceCommand({
    version: DEVICE_COMMAND_CLOUD_VERSION,
    agentId: credential.agentId,
    vaultId: credential.vaultId,
    keyVersion: 1,
    expiresInSeconds: Math.min(300, Math.max(30, Number(options.expiresInSeconds) || 120)),
    payload: {
      algorithm: 'A256GCM',
      iv: toBase64Url(iv),
      ciphertext: toBase64Url(ciphertext)
    }
  });
}

export async function decryptDeviceCommandForAgent(envelopeValue, credentialValue, options = {}) {
  const crypto = cryptoApi(options.crypto);
  const envelope = normalizeEncryptedDeviceCommand(envelopeValue);
  const credential = normalizeDeviceCommandAgentCredential(credentialValue);
  if (
    !envelope
    || !credential
    || envelope.agentId !== credential.agentId
    || envelope.vaultId !== credential.vaultId
  ) throw new Error('invalid encrypted command');
  try {
    const key = await commandKey(
      credential.secret,
      credential.agentId,
      credential.vaultId,
      ['decrypt'],
      crypto
    );
    const plaintext = await crypto.subtle.decrypt({
      name: 'AES-GCM',
      iv: fromBase64Url(envelope.payload.iv, 12, 12),
      additionalData: pairingAdditionalData(credential.agentId, credential.vaultId),
      tagLength: 128
    }, key, fromBase64Url(envelope.payload.ciphertext, 17, maximumCiphertextBytes));
    const command = normalizeDeviceCommand(JSON.parse(new TextDecoder().decode(plaintext)));
    if (!command) throw new Error('invalid decrypted command');
    return command;
  } catch (error) {
    throw new Error('could not decrypt device command');
  }
}
