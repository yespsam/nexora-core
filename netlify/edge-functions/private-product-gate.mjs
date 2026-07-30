import { getUser } from '@netlify/identity';

function privateHeaders(headers = new Headers()) {
  const result = new Headers(headers);
  result.set('Cache-Control', 'private, no-store, max-age=0');
  result.set('Cross-Origin-Resource-Policy', 'same-origin');
  result.set('Referrer-Policy', 'same-origin');
  result.set('X-Content-Type-Options', 'nosniff');
  result.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
  const vary = result.get('Vary');
  result.set('Vary', vary ? `${vary}, Cookie` : 'Cookie');
  return result;
}

function accessTarget(request) {
  const url = new URL(request.url);
  const requestedPath = `${url.pathname}${url.search}`.slice(0, 1200);
  const accessUrl = new URL('/access/', url.origin);
  accessUrl.searchParams.set('next', requestedPath.startsWith('/') ? requestedPath : '/');
  return accessUrl;
}

export function createPrivateProductGate(options = {}) {
  const getCurrentUser = options.getCurrentUser || getUser;

  return async function privateProductGate(request, context) {
    let user = null;
    try {
      user = await getCurrentUser();
    } catch (error) {
      user = null;
    }

    if (!String(user?.id || '')) {
      const url = new URL(request.url);
      if (url.pathname.startsWith('/api/')) {
        return Response.json({ error: 'authentication_required' }, {
          status: 401,
          headers: privateHeaders()
        });
      }
      return new Response(null, {
        status: 302,
        headers: privateHeaders({ Location: accessTarget(request).toString() })
      });
    }

    const response = await context.next();
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: privateHeaders(response.headers)
    });
  };
}

export default async function privateProductGate(request, context) {
  return createPrivateProductGate()(request, context);
}

export const config = {
  path: '/*',
  excludedPath: [
    '/access',
    '/access/*',
    '/api/access/*',
    '/.netlify/identity',
    '/.netlify/identity/*'
  ],
  onError: 'fail'
};
