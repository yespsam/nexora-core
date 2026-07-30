import { getUser, verifyRequestOrigin } from '@netlify/identity';

import { DeviceCloudStore } from '../../cloud/device-cloud-store.mjs';
import { createDeviceCloudFunction } from './_shared/device-cloud-data.mjs';

let store;

function environment(name) {
  return globalThis.Netlify?.env?.get?.(name) ?? process.env[name];
}

function getStore() {
  const apiConnectionString = environment('NEXORA_CLOUD_API_DATABASE_URL');
  if (!apiConnectionString) {
    throw new Error('device cloud database is not configured');
  }
  if (!store) store = new DeviceCloudStore({
    apiConnectionString,
    maintenanceConnectionString: environment('NEXORA_CLOUD_MAINTENANCE_DATABASE_URL'),
    poolMax: Number(environment('NEXORA_CLOUD_POOL_MAX') || 2),
    subjectPepper: environment('NEXORA_SUBJECT_PEPPER')
  });
  return store;
}

export default createDeviceCloudFunction({
  enabled: environment('NEXORA_DEVICE_CLOUD_ENABLED') === 'true',
  getStore,
  getCurrentUser: getUser,
  verifyOrigin: verifyRequestOrigin,
  subjectPepper: environment('NEXORA_SUBJECT_PEPPER'),
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
