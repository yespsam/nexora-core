import assert from 'node:assert/strict';
import test from 'node:test';

import {
  config as gateConfig,
  createPrivateProductGate
} from '../netlify/edge-functions/private-product-gate.mjs';
import {
  createAccessHandler,
  safeNextPath
} from '../netlify/functions/_shared/access-data.mjs';
import { config as accessConfig } from '../netlify/functions/access.mjs';

function accessHarness(overrides = {}) {
  const calls = [];
  const method = (name, result = null) => async (...args) => {
    calls.push({ name, args });
    if (result instanceof Error) throw result;
    return result;
  };
  const auth = {
    acceptInvite: method('acceptInvite', { id: 'user-1' }),
    confirmEmail: method('confirmEmail', { id: 'user-1' }),
    getUser: method('getUser', null),
    login: method('login', { id: 'user-1' }),
    logout: method('logout'),
    recoverPassword: method('recoverPassword', { id: 'user-1' }),
    requestPasswordRecovery: method('requestPasswordRecovery'),
    ...overrides.auth
  };
  const handler = createAccessHandler({
    auth,
    verifyOrigin: overrides.verifyOrigin || (() => {}),
    onError: overrides.onError || (() => {})
  });
  return { calls, handler };
}

function post(path, body, headers = {}) {
  return new Request(`https://private.test/api/access/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://private.test', ...headers },
    body: JSON.stringify(body)
  });
}

test('unauthenticated product and model requests redirect to the access gate', async () => {
  const gate = createPrivateProductGate({ getCurrentUser: async () => null });
  const response = await gate(
    new Request('https://private.test/NEXORA_3D_CREATURES/CUTE_LUMO/model/rigged.glb?cache=1'),
    { next: () => { throw new Error('must not reach origin'); } }
  );
  assert.equal(response.status, 302);
  const location = new URL(response.headers.get('location'));
  assert.equal(location.pathname, '/access/');
  assert.equal(location.searchParams.get('next'), '/NEXORA_3D_CREATURES/CUTE_LUMO/model/rigged.glb?cache=1');
  assert.match(response.headers.get('cache-control'), /no-store/);
});

test('unauthenticated APIs fail with JSON instead of redirecting credentials', async () => {
  const gate = createPrivateProductGate({ getCurrentUser: async () => null });
  const response = await gate(
    new Request('https://private.test/api/voice/status'),
    { next: () => { throw new Error('must not reach origin'); } }
  );
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: 'authentication_required' });
});

test('authenticated responses pass through with private no-store headers', async () => {
  const gate = createPrivateProductGate({ getCurrentUser: async () => ({ id: 'user-1' }) });
  const response = await gate(
    new Request('https://private.test/soulmate/'),
    { next: async () => new Response('secret', { headers: { 'Cache-Control': 'public, max-age=99' } }) }
  );
  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'secret');
  assert.match(response.headers.get('cache-control'), /private/);
  assert.match(response.headers.get('cache-control'), /no-store/);
  assert.match(response.headers.get('vary'), /Cookie/);
});

test('access, signed model routes, and Identity callbacks are the only edge exclusions', () => {
  assert.equal(gateConfig.path, '/*');
  assert.deepEqual(gateConfig.excludedPath, [
    '/access',
    '/access/*',
    '/api/access/*',
    '/api/chat/stream',
    '/api/voice/stream',
    '/.netlify/identity',
    '/.netlify/identity/*'
  ]);
  assert.equal(gateConfig.onError, 'fail');
  assert.equal(accessConfig.path, '/api/access/*');
  assert.deepEqual(accessConfig.method, ['GET', 'POST']);
});

test('login verifies origin, normalizes email, and rejects open redirects', async () => {
  let originChecks = 0;
  const harness = accessHarness({ verifyOrigin: () => { originChecks += 1; } });
  const response = await harness.handler(post('login', {
    email: '  PERSON@Example.COM ',
    password: 'long-private-password',
    next: 'https://attacker.test/steal'
  }));
  assert.equal(response.status, 200);
  assert.equal(originChecks, 1);
  assert.deepEqual(harness.calls[0], {
    name: 'login',
    args: ['person@example.com', 'long-private-password']
  });
  assert.equal((await response.json()).next, '/');
});

test('state-changing access requests fail closed on cross-origin input', async () => {
  const harness = accessHarness({ verifyOrigin: () => { throw Object.assign(new Error('bad origin'), { status: 403 }); } });
  const response = await harness.handler(post('logout', {}));
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: 'invalid_origin' });
  assert.equal(harness.calls.length, 0);
});

test('invite and recovery links use bounded tokens and never echo them', async () => {
  const token = 'T'.repeat(80);
  const harness = accessHarness();
  const response = await harness.handler(post('invite', {
    token,
    password: 'another-private-password',
    next: '/soulmate/?mode=private'
  }));
  assert.equal(response.status, 200);
  assert.equal(harness.calls[0].name, 'acceptInvite');
  assert.equal(harness.calls[0].args[0], token);
  const text = await response.text();
  assert.doesNotMatch(text, new RegExp(token));
  assert.equal(JSON.parse(text).next, '/soulmate/?mode=private');
});

test('password recovery response does not reveal whether an invited account exists', async () => {
  const missing = Object.assign(new Error('not found'), { status: 404 });
  const harness = accessHarness({ auth: { requestPasswordRecovery: async () => { throw missing; } } });
  const response = await harness.handler(post('recovery-request', { email: 'unknown@example.com' }));
  assert.equal(response.status, 202);
  assert.deepEqual(await response.json(), { accepted: true });
});

test('safe next paths stay on the same origin and outside public access routes', () => {
  assert.equal(safeNextPath('/soulmate/?scene=daily'), '/soulmate/?scene=daily');
  assert.equal(safeNextPath('//attacker.test/path'), '/');
  assert.equal(safeNextPath('https://attacker.test/path'), '/');
  assert.equal(safeNextPath('/access/?loop=1'), '/');
  assert.equal(safeNextPath('/api/access/status'), '/');
  assert.equal(safeNextPath('/safe\\redirect'), '/');
});
