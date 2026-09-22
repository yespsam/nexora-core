import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { DeviceCloudStore } from '../cloud/device-cloud-store.mjs';

test('standalone identities use isolated owners and store only hashed secrets atomically', async () => {
  const transactions = [];
  const pool = { async connect() {
    const calls = [];
    transactions.push(calls);
    return { async query(sql, params) { calls.push({sql, params}); return {rows: []}; }, release() {} };
  }};
  const store = new DeviceCloudStore({apiPool: pool, maintenancePool: pool});
  const first = await store.createStandaloneAgent();
  const second = await store.createStandaloneAgent();
  assert.notEqual(first.agentId, second.agentId);
  assert.notEqual(first.vaultId, second.vaultId);
  assert.notEqual(first.secret, second.secret);
  assert.notEqual(transactions[0][1].params[0], transactions[1][1].params[0]);
  for (const [index, value] of [first, second].entries()) {
    const calls = transactions[index];
    assert.equal(calls[0].sql, 'BEGIN');
    assert.equal(calls.at(-1).sql, 'COMMIT');
    const owner = calls[1].params[0];
    assert.equal(calls[2].params[0], owner);
    assert.equal(calls[3].params[1], owner);
    assert.equal(calls[4].params[1], owner);
    assert.equal(calls[4].params[2], calls[3].params[0]);
    assert.deepEqual(calls[4].params[3], createHash('sha256').update(Buffer.from(value.secret, 'base64url')).digest());
    assert.equal(JSON.stringify(calls).includes(value.secret), false);
  }
});

test('failed automatic enrollment rolls back the entire account', async () => {
  const calls = [];
  const pool = {async connect() {return {
    async query(sql) {calls.push(sql); if (sql.includes('INSERT INTO nexora_cloud.device_command_agents')) throw new Error('write failed');},
    release() {calls.push('released');}
  };}};
  const store = new DeviceCloudStore({apiPool: pool, maintenancePool: pool});
  await assert.rejects(store.createStandaloneAgent(), /write failed/);
  assert.deepEqual(calls.slice(-2), ['ROLLBACK', 'released']);
  assert.equal(calls.includes('COMMIT'), false);
});
