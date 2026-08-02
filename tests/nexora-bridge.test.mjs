import assert from 'node:assert/strict';
import test from 'node:test';

import { startNexoraBridge } from '../tools/nexora-bridge.mjs';

test('local bridge exposes simulation status and records validated commands', async (context) => {
  const bridge = await startNexoraBridge({ port: 0 });
  context.after(() => bridge.close());
  const origin = 'https://product-private-cloud-staging--nexora-core-staging.netlify.app';
  const status = await fetch(`${bridge.url}/status`, { headers: { Origin: origin } });
  assert.equal(status.status, 200);
  assert.equal((await status.json()).mode, 'simulation');
  assert.equal(status.headers.get('access-control-allow-origin'), origin);

  const command = await fetch(`${bridge.url}/commands`, {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      command: {
        version: 1,
        target: 'home',
        action: 'light.on',
        parameters: { room: '客厅' }
      }
    })
  });
  const body = await command.json();
  assert.equal(body.ok, true);
  assert.equal(body.status, 'simulated');
  assert.equal(body.summary, '客厅灯光已打开');
  assert.equal(bridge.events.length, 1);

  const blocked = await fetch(`${bridge.url}/status`, {
    headers: { Origin: 'https://malicious.example' }
  });
  assert.equal(blocked.status, 403);
});
