import { fromBase64Url } from '../shared/device-cloud-crypto.mjs';
import { normalizeEncryptedDeviceCommand } from '../shared/device-command-cloud.mjs';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const publicVaultIdPattern = /^[A-Za-z0-9_-]{22}$/;
const keyIdPattern = /^[A-Za-z0-9._:-]{1,64}$/;
const deviceTypes = new Set(['phone', 'pendant', 'desktop', 'recovery']);

export class DeviceCloudError extends Error {
  constructor(message, status = 400, code = 'invalid_request') {
    super(message);
    this.name = 'DeviceCloudError';
    this.status = status;
    this.code = code;
  }
}

export function requiredUuid(value, label) {
  const text = String(value || '').toLowerCase();
  if (!uuidPattern.test(text)) throw new DeviceCloudError(`invalid ${label}`);
  return text;
}

export function requiredVaultId(value) {
  const text = String(value || '');
  if (!publicVaultIdPattern.test(text)) throw new DeviceCloudError('invalid vault id');
  return text;
}

function requiredKeyId(value) {
  const text = String(value || '');
  if (!keyIdPattern.test(text)) throw new DeviceCloudError('invalid signing key id');
  return text;
}

function publicP256Jwk(value, label) {
  if (
    !value
    || typeof value !== 'object'
    || value.kty !== 'EC'
    || value.crv !== 'P-256'
    || typeof value.x !== 'string'
    || typeof value.y !== 'string'
    || value.x.length !== 43
    || value.y.length !== 43
    || value.d
  ) throw new DeviceCloudError(`invalid ${label}`);
  try {
    fromBase64Url(value.x, 32, 32);
    fromBase64Url(value.y, 32, 32);
  } catch (error) {
    throw new DeviceCloudError(`invalid ${label}`);
  }
  return { kty: 'EC', crv: 'P-256', x: value.x, y: value.y };
}

export function wrappedKey(value, label = 'wrapped vault key') {
  try {
    return Buffer.from(fromBase64Url(value, 40, 2048));
  } catch (error) {
    throw new DeviceCloudError(`invalid ${label}`);
  }
}

export function normalizeDevice(value) {
  if (!value || typeof value !== 'object') throw new DeviceCloudError('invalid device');
  const type = String(value.type || '');
  const displayName = String(value.displayName || '').trim();
  if (!deviceTypes.has(type)) throw new DeviceCloudError('invalid device type');
  if (!displayName || displayName.length > 80) throw new DeviceCloudError('invalid device name');
  return {
    id: requiredUuid(value.id, 'device id'),
    type,
    displayName,
    signingKeyId: requiredKeyId(value.signingKeyId),
    signingPublicJwk: publicP256Jwk(value.signingPublicJwk, 'signing public key'),
    exchangePublicJwk: publicP256Jwk(value.exchangePublicJwk, 'exchange public key'),
    firmwareVersion: value.firmwareVersion == null ? null : String(value.firmwareVersion).slice(0, 48),
    wrappedVaultKey: wrappedKey(value.wrappedVaultKey)
  };
}

export function normalizeRecoveryEnvelope(value) {
  if (!value || typeof value !== 'object') throw new DeviceCloudError('invalid recovery envelope');
  let recoveryKeyId;
  try {
    recoveryKeyId = fromBase64Url(value.recoveryKeyId, 32, 32);
  } catch (error) {
    throw new DeviceCloudError('invalid recovery key id');
  }
  return {
    recoveryKeyId: Buffer.from(recoveryKeyId),
    wrappedVaultKey: wrappedKey(value.wrappedVaultKey, 'recovery wrapped vault key')
  };
}

export function normalizeDeviceCommandAgent(value) {
  if (!value || typeof value !== 'object' || value.version !== 1) {
    throw new DeviceCloudError('invalid command agent');
  }
  const displayName = String(value.displayName || '').trim();
  let credentialHash;
  try {
    credentialHash = Buffer.from(fromBase64Url(value.credentialHash, 32, 32));
  } catch (error) {
    throw new DeviceCloudError('invalid command agent credential');
  }
  if (!displayName || displayName.length > 80) throw new DeviceCloudError('invalid command agent name');
  return {
    id: requiredUuid(value.agentId, 'command agent id'),
    vaultId: requiredVaultId(value.vaultId),
    displayName,
    credentialHash
  };
}

export function normalizeDeviceCommandSubmission(value) {
  const command = normalizeEncryptedDeviceCommand(value);
  if (!command) throw new DeviceCloudError('invalid encrypted device command');
  return {
    ...command,
    iv: Buffer.from(fromBase64Url(command.payload.iv, 12, 12)),
    ciphertext: Buffer.from(fromBase64Url(command.payload.ciphertext, 17, 16384))
  };
}

export function normalizeEncryptedSnapshot(value) {
  if (!value || typeof value !== 'object') throw new DeviceCloudError('invalid encrypted snapshot');
  const throughCursor = Number(value.throughCursor);
  const keyVersion = Number(value.keyVersion);
  if (!Number.isSafeInteger(throughCursor) || throughCursor < 0) {
    throw new DeviceCloudError('invalid snapshot cursor');
  }
  if (!Number.isSafeInteger(keyVersion) || keyVersion < 1) {
    throw new DeviceCloudError('invalid snapshot key version');
  }
  if (value.payload?.algorithm !== 'A256GCM') {
    throw new DeviceCloudError('invalid snapshot encryption algorithm');
  }
  let iv;
  let ciphertext;
  try {
    iv = Buffer.from(fromBase64Url(value.payload.iv, 12, 12));
    ciphertext = Buffer.from(fromBase64Url(value.payload.ciphertext, 17, 262144));
  } catch (error) {
    throw new DeviceCloudError('invalid encrypted snapshot payload');
  }
  return {
    vaultId: requiredVaultId(value.vaultId),
    deviceId: requiredUuid(value.deviceId, 'snapshot device id'),
    throughCursor,
    keyVersion,
    iv,
    ciphertext
  };
}
