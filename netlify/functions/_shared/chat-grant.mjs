import { createHmac, timingSafeEqual } from 'node:crypto';

const tokenVersion = 'ncg1';

export function cleanChatGrantRelease(value) {
  const release = String(value || '').trim().slice(0, 64);
  return /^[a-zA-Z0-9][a-zA-Z0-9._-]{7,63}$/.test(release) ? release : '';
}

function signatureFor(payload, secret) {
  return createHmac('sha256', secret)
    .update(`${tokenVersion}.${payload}`)
    .digest('base64url');
}

export function createChatGrant(releaseValue, secretValue, {
  now = Date.now(),
  ttlMs = 480_000
} = {}) {
  const release = cleanChatGrantRelease(releaseValue);
  const secret = String(secretValue || '');
  if (!release || secret.length < 16) return '';
  const issuedAt = Math.floor(Number(now) / 1000);
  const ttlSeconds = Math.max(30, Math.min(600, Math.ceil(Number(ttlMs) / 1000) || 480));
  const payload = Buffer.from(JSON.stringify({
    v: 1,
    iat: issuedAt,
    exp: issuedAt + ttlSeconds,
    r: release
  })).toString('base64url');
  return `${tokenVersion}.${payload}.${signatureFor(payload, secret)}`;
}

export function verifyChatGrant(tokenValue, releaseValue, secretValue, {
  now = Date.now()
} = {}) {
  const release = cleanChatGrantRelease(releaseValue);
  const secret = String(secretValue || '');
  const parts = String(tokenValue || '').split('.');
  if (!release || secret.length < 16 || parts.length !== 3 || parts[0] !== tokenVersion) return false;
  const expected = Buffer.from(signatureFor(parts[1], secret));
  const received = Buffer.from(parts[2]);
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) return false;
  let claims;
  try {
    claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch (error) {
    return false;
  }
  const nowSeconds = Math.floor(Number(now) / 1000);
  const issuedAt = Number(claims?.iat) || 0;
  const expiresAt = Number(claims?.exp) || 0;
  return claims?.v === 1
    && issuedAt <= nowSeconds + 30
    && issuedAt >= nowSeconds - 600
    && expiresAt >= nowSeconds
    && expiresAt <= issuedAt + 600
    && claims.r === release;
}
