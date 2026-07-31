export const SOULMATE_CLOUD_RETRY_DELAYS_MS = Object.freeze([
  2000,
  5000,
  15000,
  30000,
  60000
]);

export function soulmateCloudRetryDelay(attempt = 0) {
  const index = Math.max(0, Math.floor(Number(attempt) || 0));
  return SOULMATE_CLOUD_RETRY_DELAYS_MS[
    Math.min(index, SOULMATE_CLOUD_RETRY_DELAYS_MS.length - 1)
  ];
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
