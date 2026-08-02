import { createHmac, timingSafeEqual } from 'node:crypto';

const tokenVersion = 'nvg1';
const allowedPersonas = new Set([
  'creature:cute',
  'creature:cool',
  'creature:beautiful',
  'female',
  'male'
]);
const allowedArchetypes = new Set([
  'sprout', 'edge', 'aether', 'default',
  'loli', 'yujie', 'funny', 'shonen', 'uncle', ''
]);
const allowedStarters = new Set(['cute', 'cool', 'beautiful', '']);

export function cleanVoiceGrantScope(value = {}) {
  const input = value && typeof value === 'object' ? value : {};
  const persona = String(input.persona || '').trim().toLowerCase().slice(0, 40);
  const archetype = String(input.archetype || input.voice || '').trim().toLowerCase().slice(0, 24);
  const starter = String(input.starter || '').trim().toLowerCase().slice(0, 24);
  if (
    !allowedPersonas.has(persona)
    || !allowedArchetypes.has(archetype)
    || !allowedStarters.has(starter)
  ) return null;
  return { persona, archetype, starter };
}

function signatureFor(payload, secret) {
  return createHmac('sha256', secret)
    .update(`${tokenVersion}.${payload}`)
    .digest('base64url');
}

export function createVoiceGrant(scopeValue, secretValue, {
  now = Date.now(),
  ttlMs = 45_000
} = {}) {
  const scope = cleanVoiceGrantScope(scopeValue);
  const secret = String(secretValue || '');
  if (!scope || secret.length < 16) return '';
  const nowSeconds = Math.floor(Number(now) / 1000);
  const ttlSeconds = Math.max(5, Math.min(90, Math.ceil(Number(ttlMs) / 1000) || 45));
  const payload = Buffer.from(JSON.stringify({
    v: 1,
    exp: nowSeconds + ttlSeconds,
    p: scope.persona,
    a: scope.archetype,
    s: scope.starter
  })).toString('base64url');
  return `${tokenVersion}.${payload}.${signatureFor(payload, secret)}`;
}

export function verifyVoiceGrant(tokenValue, scopeValue, secretValue, {
  now = Date.now()
} = {}) {
  const scope = cleanVoiceGrantScope(scopeValue);
  const secret = String(secretValue || '');
  const parts = String(tokenValue || '').split('.');
  if (!scope || secret.length < 16 || parts.length !== 3 || parts[0] !== tokenVersion) return false;
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
  const expiresAt = Number(claims?.exp) || 0;
  return claims?.v === 1
    && expiresAt >= nowSeconds
    && expiresAt <= nowSeconds + 90
    && claims.p === scope.persona
    && claims.a === scope.archetype
    && claims.s === scope.starter;
}
