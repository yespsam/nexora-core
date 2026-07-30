const maximumBodyBytes = 16000;

function json(body, status = 200, extraHeaders = {}) {
  return Response.json(body, {
    status,
    headers: {
      'Cache-Control': 'private, no-store, max-age=0',
      'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
      'Cross-Origin-Resource-Policy': 'same-origin',
      'Referrer-Policy': 'same-origin',
      'X-Content-Type-Options': 'nosniff',
      'X-Robots-Tag': 'noindex, nofollow, noarchive',
      ...extraHeaders
    }
  });
}

async function bodyJson(request) {
  const declaredLength = Number(request.headers.get('content-length') || 0);
  if (declaredLength > maximumBodyBytes) throw Object.assign(new Error('payload too large'), { status: 413 });
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > maximumBodyBytes) {
    throw Object.assign(new Error('payload too large'), { status: 413 });
  }
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch (error) {
    throw Object.assign(new Error('invalid json'), { status: 400 });
  }
}

function emailAddress(value) {
  const email = String(value || '').trim().toLowerCase();
  if (email.length < 5 || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw Object.assign(new Error('invalid email'), { status: 400 });
  }
  return email;
}

function passwordValue(value) {
  const password = String(value || '');
  if (password.length < 10 || password.length > 128) {
    throw Object.assign(new Error('invalid password'), { status: 400 });
  }
  return password;
}

function callbackToken(value) {
  const token = String(value || '').trim();
  if (token.length < 20 || token.length > 4096 || /\s/.test(token)) {
    throw Object.assign(new Error('invalid token'), { status: 400 });
  }
  return token;
}

export function safeNextPath(value) {
  const raw = String(value || '/').trim();
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\') || raw.length > 1200) return '/';
  try {
    const parsed = new URL(raw, 'https://nexora.invalid');
    if (parsed.origin !== 'https://nexora.invalid') return '/';
    if (parsed.pathname.startsWith('/access') || parsed.pathname.startsWith('/api/access')) return '/';
    return `${parsed.pathname}${parsed.search}`;
  } catch (error) {
    return '/';
  }
}

function publicError(error, route) {
  const status = Number(error?.status);
  if (status === 413) return { status, code: 'payload_too_large' };
  if (route === 'login' && [400, 401, 404, 422].includes(status)) {
    return { status: 401, code: 'invalid_credentials' };
  }
  if (['invite', 'recovery-complete', 'confirm'].includes(route) && [401, 403, 404].includes(status)) {
    return { status: 400, code: 'invalid_or_expired_link' };
  }
  if (status === 400 || status === 422) return { status: 400, code: 'invalid_request' };
  return { status: 503, code: 'identity_unavailable' };
}

export function createAccessHandler(options) {
  const auth = options.auth;
  const verifyOrigin = options.verifyOrigin;
  const onError = options.onError || (() => {});

  return async function accessHandler(request) {
    const url = new URL(request.url);
    const route = url.pathname.replace(/^\/api\/access\/?/, '') || 'status';

    if (request.method === 'GET' && route === 'status') {
      try {
        const user = await auth.getUser();
        return json({ authenticated: Boolean(user?.id) });
      } catch (error) {
        onError(error);
        return json({ authenticated: false, error: 'identity_unavailable' }, 503);
      }
    }
    if (request.method !== 'POST') return json({ error: 'not_found' }, 404);

    try {
      try {
        verifyOrigin(request);
      } catch (error) {
        return json({ error: 'invalid_origin' }, 403);
      }
      const body = await bodyJson(request);
      const next = safeNextPath(body.next);

      if (route === 'login') {
        await auth.login(emailAddress(body.email), passwordValue(body.password));
        return json({ authenticated: true, next });
      }
      if (route === 'logout') {
        await auth.logout();
        return json({ authenticated: false, next: '/access/?signedOut=1' });
      }
      if (route === 'invite') {
        await auth.acceptInvite(callbackToken(body.token), passwordValue(body.password));
        return json({ authenticated: true, next });
      }
      if (route === 'recovery-request') {
        const email = emailAddress(body.email);
        try {
          await auth.requestPasswordRecovery(email);
        } catch (error) {
          if (!Number.isFinite(Number(error?.status)) || Number(error.status) >= 500) throw error;
        }
        return json({ accepted: true }, 202);
      }
      if (route === 'recovery-complete') {
        await auth.recoverPassword(callbackToken(body.token), passwordValue(body.password));
        return json({ authenticated: true, next });
      }
      if (route === 'confirm') {
        await auth.confirmEmail(callbackToken(body.token));
        return json({ authenticated: true, next });
      }
      return json({ error: 'not_found' }, 404);
    } catch (caught) {
      const error = publicError(caught, route);
      if (error.status >= 500) onError(caught);
      return json({ error: error.code }, error.status);
    }
  };
}
