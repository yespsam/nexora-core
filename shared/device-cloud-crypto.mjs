const base64UrlPattern = /^[A-Za-z0-9_-]+$/;

function cryptoApi(value = globalThis.crypto) {
  if (!value?.getRandomValues || !value?.subtle) throw new Error('secure crypto unavailable');
  return value;
}

export function toBase64Url(value) {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const encoded = typeof btoa === 'function'
    ? btoa(binary)
    : Buffer.from(bytes).toString('base64');
  return encoded.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function fromBase64Url(value, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
  const text = String(value || '');
  if (!base64UrlPattern.test(text) || text.length % 4 === 1) throw new Error('invalid base64url value');
  const base64 = text.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(text.length / 4) * 4, '=');
  const binary = typeof atob === 'function'
    ? atob(base64)
    : Buffer.from(base64, 'base64').toString('binary');
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  if (toBase64Url(bytes) !== text || bytes.byteLength < minimum || bytes.byteLength > maximum) {
    throw new Error('invalid base64url value');
  }
  return bytes;
}

export async function createDeviceCloudKeys(cryptoValue = globalThis.crypto) {
  const crypto = cryptoApi(cryptoValue);
  const signing = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify']
  );
  const exchange = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveKey', 'deriveBits']
  );
  return {
    signing,
    exchange,
    signingPublicJwk: await crypto.subtle.exportKey('jwk', signing.publicKey),
    exchangePublicJwk: await crypto.subtle.exportKey('jwk', exchange.publicKey)
  };
}

export async function createVaultKey(cryptoValue = globalThis.crypto) {
  return cryptoApi(cryptoValue).subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}

function uint32(value) {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value, false);
  return bytes;
}

function concatBytes(...values) {
  const size = values.reduce((total, value) => total + value.byteLength, 0);
  const result = new Uint8Array(size);
  let offset = 0;
  for (const value of values) {
    result.set(value, offset);
    offset += value.byteLength;
  }
  return result;
}

async function ecdhEsWrappingKey(privateKey, publicKey, usages, crypto) {
  const sharedSecret = new Uint8Array(await crypto.subtle.deriveBits(
    { name: 'ECDH', public: publicKey },
    privateKey,
    256
  ));
  const algorithm = new TextEncoder().encode('A256KW');
  const otherInfo = concatBytes(
    uint32(algorithm.byteLength),
    algorithm,
    uint32(0),
    uint32(0),
    uint32(256)
  );
  const keyBytes = await crypto.subtle.digest(
    'SHA-256',
    concatBytes(uint32(1), sharedSecret, otherInfo)
  );
  return crypto.subtle.importKey('raw', keyBytes, 'AES-KW', false, usages);
}

export async function wrapVaultKeyForDevice(vaultKey, devicePublicJwk, cryptoValue = globalThis.crypto) {
  const crypto = cryptoApi(cryptoValue);
  const recipient = await crypto.subtle.importKey(
    'jwk',
    devicePublicJwk,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    []
  );
  const ephemeral = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveKey', 'deriveBits']
  );
  const wrappingKey = await ecdhEsWrappingKey(ephemeral.privateKey, recipient, ['wrapKey'], crypto);
  const wrapped = await crypto.subtle.wrapKey('raw', vaultKey, wrappingKey, 'AES-KW');
  const envelope = {
    version: 1,
    ephemeralPublicJwk: await crypto.subtle.exportKey('jwk', ephemeral.publicKey),
    wrappedKey: toBase64Url(wrapped)
  };
  return toBase64Url(new TextEncoder().encode(JSON.stringify(envelope)));
}

export async function unwrapDeviceEnvelope(wrappedVaultKey, recipientPrivateKey, cryptoValue = globalThis.crypto) {
  const crypto = cryptoApi(cryptoValue);
  let envelope;
  try {
    envelope = JSON.parse(new TextDecoder().decode(fromBase64Url(wrappedVaultKey, 40, 2048)));
  } catch (error) {
    throw new Error('invalid device key envelope');
  }
  if (envelope?.version !== 1 || typeof envelope.wrappedKey !== 'string') {
    throw new Error('invalid device key envelope');
  }
  const ephemeral = await crypto.subtle.importKey(
    'jwk',
    envelope.ephemeralPublicJwk,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    []
  );
  const wrappingKey = await ecdhEsWrappingKey(recipientPrivateKey, ephemeral, ['unwrapKey'], crypto);
  return crypto.subtle.unwrapKey(
    'raw',
    fromBase64Url(envelope.wrappedKey, 40, 40),
    wrappingKey,
    'AES-KW',
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt']
  );
}

export async function createRecoveryEnvelope(vaultKey, recoverySecret, cryptoValue = globalThis.crypto) {
  const crypto = cryptoApi(cryptoValue);
  const secret = recoverySecret || crypto.getRandomValues(new Uint8Array(32));
  const material = await crypto.subtle.importKey('raw', secret, 'HKDF', false, ['deriveKey']);
  const wrappingKey = await crypto.subtle.deriveKey({
    name: 'HKDF',
    hash: 'SHA-256',
    salt: new TextEncoder().encode('nexora-core-recovery-v1'),
    info: new TextEncoder().encode('vault-key-wrap')
  }, material, { name: 'AES-KW', length: 256 }, false, ['wrapKey']);
  const wrapped = await crypto.subtle.wrapKey('raw', vaultKey, wrappingKey, 'AES-KW');
  const keyId = await crypto.subtle.digest('SHA-256', secret);
  return {
    recoverySecret: new Uint8Array(secret),
    recoveryKeyId: toBase64Url(keyId),
    wrappedVaultKey: toBase64Url(wrapped)
  };
}

export async function unwrapRecoveryEnvelope(wrappedVaultKey, recoverySecret, cryptoValue = globalThis.crypto) {
  const crypto = cryptoApi(cryptoValue);
  const secret = recoverySecret instanceof Uint8Array
    ? recoverySecret
    : new Uint8Array(recoverySecret);
  const material = await crypto.subtle.importKey('raw', secret, 'HKDF', false, ['deriveKey']);
  const wrappingKey = await crypto.subtle.deriveKey({
    name: 'HKDF',
    hash: 'SHA-256',
    salt: new TextEncoder().encode('nexora-core-recovery-v1'),
    info: new TextEncoder().encode('vault-key-wrap')
  }, material, { name: 'AES-KW', length: 256 }, false, ['unwrapKey']);
  return crypto.subtle.unwrapKey(
    'raw',
    fromBase64Url(wrappedVaultKey, 40, 40),
    wrappingKey,
    'AES-KW',
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt']
  );
}
