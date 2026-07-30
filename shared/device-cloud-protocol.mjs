export const DEVICE_CLOUD_EVENT_VERSION = 1;
export const DEVICE_CLOUD_EVENT_ALGORITHM = 'A256GCM';
export const DEVICE_CLOUD_SIGNATURE_ALGORITHM = 'ES256';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const publicVaultIdPattern = /^[A-Za-z0-9_-]{22}$/;
const base64UrlPattern = /^[A-Za-z0-9_-]+$/;
const hashPattern = /^[A-Za-z0-9_-]{43}$/;
const signaturePattern = /^[A-Za-z0-9_-]{86}$/;
const keyIdPattern = /^[A-Za-z0-9._:-]{1,64}$/;
const minimumCiphertextLength = 23; // 17 bytes, including the AES-GCM authentication tag.
const maximumCiphertextLength = 349526; // 262144 bytes without base64url padding.

function integer(value, min, max) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max
    ? value
    : null;
}

function isoTimestamp(value, now) {
  const text = String(value || '');
  if (text.length < 20 || text.length > 32) return '';
  const time = Date.parse(text);
  if (!Number.isFinite(time) || time < Date.UTC(2024, 0, 1) || time > now + 86400000) return '';
  return new Date(time).toISOString();
}

function encryptedPayload(value) {
  if (!value || typeof value !== 'object' || value.algorithm !== DEVICE_CLOUD_EVENT_ALGORITHM) return null;
  const iv = String(value.iv || '');
  const ciphertext = String(value.ciphertext || '');
  if (!base64UrlPattern.test(iv) || iv.length !== 16) return null;
  if (
    !base64UrlPattern.test(ciphertext)
    || ciphertext.length < minimumCiphertextLength
    || ciphertext.length > maximumCiphertextLength
    || ciphertext.length % 4 === 1
  ) return null;
  return {
    algorithm: DEVICE_CLOUD_EVENT_ALGORITHM,
    iv,
    ciphertext
  };
}

function eventAuthentication(value) {
  if (!value || typeof value !== 'object' || value.algorithm !== DEVICE_CLOUD_SIGNATURE_ALGORITHM) return null;
  const keyId = String(value.keyId || '');
  const signature = String(value.signature || '');
  if (!keyIdPattern.test(keyId) || !signaturePattern.test(signature)) return null;
  return {
    algorithm: DEVICE_CLOUD_SIGNATURE_ALGORITHM,
    keyId,
    signature
  };
}

export function normalizeDeviceCloudEvent(value, now = Date.now()) {
  if (!value || typeof value !== 'object' || value.version !== DEVICE_CLOUD_EVENT_VERSION) return null;
  const eventId = String(value.eventId || '');
  const vaultId = String(value.vaultId || '');
  const deviceId = String(value.deviceId || '');
  const deviceSequence = integer(value.deviceSequence, 1, Number.MAX_SAFE_INTEGER);
  const keyVersion = integer(value.keyVersion, 1, 1000000);
  const occurredAt = isoTimestamp(value.occurredAt, now);
  const previousEventHash = value.previousEventHash === '' || value.previousEventHash == null
    ? ''
    : String(value.previousEventHash);
  const payload = encryptedPayload(value.payload);
  const auth = eventAuthentication(value.auth);
  if (!uuidPattern.test(eventId) || !publicVaultIdPattern.test(vaultId) || !uuidPattern.test(deviceId)) return null;
  if (!deviceSequence || !keyVersion || !occurredAt || !payload || !auth) return null;
  if (previousEventHash && !hashPattern.test(previousEventHash)) return null;
  if ((deviceSequence === 1 && previousEventHash) || (deviceSequence > 1 && !previousEventHash)) return null;
  return {
    version: DEVICE_CLOUD_EVENT_VERSION,
    eventId: eventId.toLowerCase(),
    vaultId,
    deviceId: deviceId.toLowerCase(),
    deviceSequence,
    occurredAt,
    keyVersion,
    previousEventHash,
    payload,
    auth
  };
}

export function canonicalDeviceCloudEvent(value) {
  const event = normalizeDeviceCloudEvent(value);
  if (!event) return '';
  return JSON.stringify({
    version: event.version,
    eventId: event.eventId,
    vaultId: event.vaultId,
    deviceId: event.deviceId,
    deviceSequence: event.deviceSequence,
    occurredAt: event.occurredAt,
    keyVersion: event.keyVersion,
    previousEventHash: event.previousEventHash,
    payload: event.payload,
    auth: {
      algorithm: event.auth.algorithm,
      keyId: event.auth.keyId
    }
  });
}

export function deviceCloudEventStorageKey(value) {
  const event = normalizeDeviceCloudEvent(value);
  if (!event) return '';
  return `${event.vaultId}/${event.deviceId}/${String(event.deviceSequence).padStart(16, '0')}/${event.eventId}`;
}
