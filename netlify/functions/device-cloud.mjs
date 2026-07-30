import { getUser, verifyRequestOrigin } from '@netlify/identity';
import { getDatabase } from '@netlify/database';

import { DeviceCloudStore } from '../../cloud/device-cloud-store.mjs';
import { createDeviceCloudFunction } from './_shared/device-cloud-data.mjs';
import {
  createNetlifySnapshotObjects,
  snapshotNamespace
} from './_shared/device-cloud-objects.mjs';

let store;

function environment(name) {
  return globalThis.Netlify?.env?.get?.(name) ?? process.env[name];
}

function getStore() {
  if (!store) {
    const database = getDatabase();
    store = new DeviceCloudStore({
      apiPool: database.pool,
      maintenancePool: database.pool,
      subjectPepper: environment('NEXORA_SUBJECT_PEPPER')
    });
  }
  return store;
}

export default createDeviceCloudFunction({
  enabled: environment('NEXORA_DEVICE_CLOUD_ENABLED') === 'true',
  getStore,
  getCurrentUser: getUser,
  verifyOrigin: verifyRequestOrigin,
  subjectPepper: environment('NEXORA_SUBJECT_PEPPER'),
  dualWriteEnabled: environment('NEXORA_DEVICE_CLOUD_DUAL_WRITE_ENABLED') === 'true',
  getSnapshotObjects: createNetlifySnapshotObjects,
  getSnapshotNamespace: snapshotNamespace,
  onError(error) {
    console.error('[device-cloud-function]', {
      name: String(error?.name || 'Error').slice(0, 80),
      code: String(error?.code || 'unknown').slice(0, 80),
      message: String(error?.message || 'device cloud unavailable').slice(0, 200)
    });
  }
});

export const config = {
  path: '/api/device-cloud/*',
  method: ['GET', 'POST'],
  rateLimit: {
    windowLimit: 300,
    windowSize: 60,
    aggregateBy: ['ip', 'domain']
  }
};
