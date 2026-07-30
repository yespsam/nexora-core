import assert from 'node:assert/strict';
import test from 'node:test';

import { createDeviceCloudDeletionWorker } from '../netlify/functions/_shared/device-cloud-maintenance-data.mjs';
import deployedHandler, { config } from '../netlify/functions/device-cloud-maintenance.mjs';

test('maintenance worker is disabled by default and does not connect to storage', async () => {
  let connections = 0;
  const handler = createDeviceCloudDeletionWorker({
    enabled: false,
    getStore: () => { connections += 1; },
    getSnapshotObjects: () => { connections += 1; }
  });
  const response = await handler();
  assert.equal(response.status, 200);
  assert.equal((await response.json()).processed, 0);
  assert.equal(connections, 0);
});

test('maintenance worker deletes snapshot objects before completing due requests', async () => {
  const calls = [];
  const store = {
    async listDueDeletions(limit) {
      assert.equal(limit, 3);
      return [{ ownerId: 'owner-a', requestId: 'request-a' }];
    },
    async executeDeletion(ownerId, requestId, options) {
      calls.push({ ownerId, requestId });
      await options.deleteObjects(['staging/snapshots/encrypted.bin']);
    }
  };
  const objects = {
    async deleteMany(keys) {
      calls.push({ keys });
    }
  };
  const handler = createDeviceCloudDeletionWorker({
    enabled: true,
    getStore: () => store,
    getSnapshotObjects: () => objects,
    limit: 3
  });
  const response = await handler();
  assert.deepEqual(await response.json(), { enabled: true, processed: 1, failed: 0 });
  assert.deepEqual(calls, [
    { ownerId: 'owner-a', requestId: 'request-a' },
    { keys: ['staging/snapshots/encrypted.bin'] }
  ]);
});

test('scheduled maintenance function has no public path and remains off in production defaults', async () => {
  assert.equal(config.schedule, '@hourly');
  assert.equal('path' in config, false);
  const response = await deployedHandler();
  assert.equal((await response.json()).enabled, false);
});
