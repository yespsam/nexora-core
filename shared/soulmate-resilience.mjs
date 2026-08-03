export const SOULMATE_CLOUD_RETRY_DELAYS_MS = Object.freeze([
  2000,
  5000,
  15000,
  30000,
  60000
]);

export const SOULMATE_CHAT_RETRY_DELAYS_MS = Object.freeze([
  650,
  1800
]);

export const SOULMATE_CHAT_REQUEST_TIMEOUT_MS = 28000;

const retryableChatStatuses = new Set([408, 425, 500, 502, 503, 504]);
const retryableChatFailures = new Set([
  'client_network',
  'client_timeout',
  'request_failed',
  'server_key_network',
  'server_key_timeout',
  'server_key_provider',
  'gateway_failed'
]);

export function soulmateCloudRetryDelay(attempt = 0) {
  const index = Math.max(0, Math.floor(Number(attempt) || 0));
  return SOULMATE_CLOUD_RETRY_DELAYS_MS[
    Math.min(index, SOULMATE_CLOUD_RETRY_DELAYS_MS.length - 1)
  ];
}

export function soulmateChatRetryDelay(attempt = 0) {
  const index = Math.max(0, Math.floor(Number(attempt) || 0));
  return SOULMATE_CHAT_RETRY_DELAYS_MS[
    Math.min(index, SOULMATE_CHAT_RETRY_DELAYS_MS.length - 1)
  ];
}

export function soulmateChatNetworkFailure({ timedOut = false, online = true } = {}) {
  if (!online) return 'client_offline';
  return timedOut ? 'client_timeout' : 'client_network';
}

export function canRetrySoulmateChat({
  attempt = 0,
  status = 0,
  failure = '',
  partial = false,
  online = true
} = {}) {
  const retryIndex = Math.max(0, Math.floor(Number(attempt) || 0));
  if (!online || partial || retryIndex >= SOULMATE_CHAT_RETRY_DELAYS_MS.length) return false;
  return retryableChatStatuses.has(Number(status))
    || retryableChatFailures.has(String(failure));
}

export function removeUndeliveredSoulmateTurn(history, text) {
  const turns = Array.isArray(history) ? history : [];
  const expected = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 160);
  const last = turns.at(-1);
  const actual = String(last?.content || '').replace(/\s+/g, ' ').trim().slice(0, 160);
  return expected && last?.role === 'user' && actual === expected
    ? turns.slice(0, -1)
    : turns;
}

export function canResumeSoulmateCloudSync({
  ready = false,
  identity = null,
  profile = null,
  busy = false,
  dirty = false,
  online = true
} = {}) {
  return Boolean(ready && identity && profile && !busy && dirty && online);
}

export function isPrivateAccessExpired(status, error = '') {
  return Number(status) === 401 && String(error) === 'authentication_required';
}

export function privateAccessLoginPath(locationValue = {}) {
  const pathname = String(locationValue.pathname || '/');
  const search = String(locationValue.search || '');
  const safePath = pathname.startsWith('/') && !pathname.startsWith('//')
    ? pathname
    : '/';
  const safeSearch = search.startsWith('?') ? search : '';
  const next = `${safePath}${safeSearch}`.slice(0, 1200);
  return `/access/?${new URLSearchParams({ next }).toString()}`;
}
