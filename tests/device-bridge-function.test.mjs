import assert from 'node:assert/strict';
import test from 'node:test';

import { createDeviceBridgeFunction } from '../netlify/functions/_shared/device-bridge-data.mjs';
import deployedHandler, { config } from '../netlify/functions/device-bridge.mjs';

const agentId = 'ef53f13f-b1a5-47ff-a759-171557c32e13';
const secret = 'S'.repeat(43);

function harness(overrides = {}) {
  const calls = [];
  const store = {
    async authenticateCommandAgent(...args) {
      calls.push({ method: 'authenticateCommandAgent', args });
      return { agentId, ownerId: 'owner', vaultId: 'A'.repeat(22), vaultUuid: 'vault' };
    },
    async claimCommand(...args) {
      calls.push({ method: 'claimCommand', args });
      return { command: null };
    },
    async acknowledgeCommand(...args) {
      calls.push({ method: 'acknowledgeCommand', args });
      return { status: 'acknowledged' };
    },
    ...overrides.store
  };
  return {
    calls,
    handler: createDeviceBridgeFunction({ enabled: true, getStore: () => store, ...overrides })
  };
}

function request(path, options = {}) {
  return new Request(`https://example.test${path}${path.includes('?') ? '&' : '?'}agentId=${agentId}`, {
    ...options,
    headers: { Authorization: `Bearer ${secret}`, ...(options.headers || {}) }
  });
}

test('device bridge remains disabled by default in deployed test environments', async () => {
  const response = await deployedHandler(request('/api/device-bridge/status'));
  assert.equal(response.status, 404);
});

test('bridge polling authenticates before atomically claiming work', async () => {
  const app = harness();
  const response = await app.handler(request('/api/device-bridge/commands'));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { command: null });
  assert.deepEqual(app.calls.map((call) => call.method), [
    'authenticateCommandAgent',
    'claimCommand'
  ]);
  assert.equal(app.calls[0].args[0], agentId);
  assert.equal(app.calls[0].args[1], secret);
});

test('bridge acknowledgements are bound to the authenticated agent', async () => {
  const app = harness();
  const commandId = '6245cdab-cd29-4f58-83ca-1f3b3c95d512';
  const response = await app.handler(request(`/api/device-bridge/commands/${commandId}/ack`, {
    method: 'POST',
    body: JSON.stringify({ outcome: 'acknowledged' })
  }));
  assert.equal(response.status, 200);
  assert.equal(app.calls[1].method, 'acknowledgeCommand');
  assert.equal(app.calls[1].args[1], commandId);
  assert.equal(app.calls[1].args[2], 'acknowledged');
});

test('paired desktop companion can reach chat without browser cookies', async () => {
  let forwarded;
  const app = harness({
    async handleChat(request) {
      forwarded = request;
      return Response.json({ text: '我在。', actions: [{ target: 'companion', action: 'voice' }] });
    }
  });
  const response = await app.handler(request('/api/device-bridge/chat', {
    method: 'POST',
    body: JSON.stringify({ text: '你好', persona: 'creature:cute', history: [] })
  }));
  assert.equal(response.status, 200);
  assert.equal(forwarded.headers.get('authorization'), null);
  assert.equal(forwarded.headers.get('x-nexora-client-release'), 'desktop-pet-native-v1');
  assert.equal((await forwarded.json()).text, '你好');
  assert.equal((await response.json()).text, '我在。');
  assert.deepEqual(app.calls.map((call) => call.method), ['authenticateCommandAgent']);
});

test('paired desktop companion can request its matching voice', async () => {
  let voicePayload;
  const app = harness({
    async handleVoice(payload) {
      voicePayload = payload;
      return new Response(new Uint8Array([1, 2, 3]), {
        headers: { 'Content-Type': 'audio/mpeg' }
      });
    }
  });
  const response = await app.handler(request('/api/device-bridge/voice', {
    method: 'POST',
    body: JSON.stringify({ text: '我在。', persona: 'creature:cool', starter: 'cool' })
  }));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'audio/mpeg');
  assert.equal(voicePayload.starter, 'cool');
  assert.deepEqual(app.calls.map((call) => call.method), ['authenticateCommandAgent']);
});

test('bridge rejects missing bearer credentials before polling', async () => {
  const app = harness();
  const response = await app.handler(new Request(
    `https://example.test/api/device-bridge/commands?agentId=${agentId}`
  ));
  assert.equal(response.status, 401);
  assert.equal(app.calls.length, 0);
});

test('device bridge route is bounded independently from the private browser gate', () => {
  assert.equal(config.path, '/api/device-bridge/*');
  assert.deepEqual(config.method, ['GET', 'POST']);
  assert.equal(config.rateLimit.windowLimit, 180);
});

test('new installations can create an independent identity without a pairing code', async () => {
  let count = 0;
  const app = harness({store: {
    async createStandaloneAgent(...args) {
      assert.deepEqual(args, []);
      count++;
      return { agentId: `new-${count}`, secret: 'new-secret' };
    },
    async authenticateCommandAgent() { throw new Error('bootstrap must not need existing credentials'); }
  }});
  for (let index = 1; index <= 2; index++) {
    const response = await app.handler(new Request('https://example.test/api/device-bridge/start', {
      method: 'POST', body: JSON.stringify({ vaultId: 'someone-elses-vault' })
    }));
    assert.equal(response.status, 201);
    assert.equal((await response.json()).credential.agentId, `new-${index}`);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }
});

test('initialization rejects malformed payloads and disabled deployments', async () => {
  const app = harness();
  const response = await app.handler(new Request('https://example.test/api/device-bridge/start', {method: 'POST', body: '{'}));
  assert.equal(response.status, 400);
  const disabled = harness({enabled: false});
  assert.equal((await disabled.handler(new Request('https://example.test/api/device-bridge/start', {method: 'POST'}))).status, 404);
});

test('desktop chat receives owner-scoped saved personality and editable memories', async () => {
  let submitted;
  const app = harness({
    async getCompanionProfile(auth) { assert.equal(auth.agentId, agentId); return {name:'小伴',voice:'beautiful',personality:'温柔',memories:['喜欢散步']}; },
    async handleChat(request) { submitted=await request.json(); return Response.json({text:'我记得。'}); }
  });
  const response=await app.handler(request('/api/device-bridge/chat',{method:'POST',body:JSON.stringify({text:'你好',soulmate:{name:'旧名字',memories:['客户端过期资料']}})}));
  assert.equal(response.status,200);
  assert.equal(submitted.soulmate.name,'小伴');assert.equal(submitted.soulmate.personality,'温柔');
  assert.deepEqual(submitted.soulmate.memories,['喜欢散步']);assert.equal(submitted.persona,'creature:beautiful');assert.equal(submitted.soulmate.custom,true);
});
