import { getDatabase } from '@netlify/database';

import { DeviceCloudStore } from '../../cloud/device-cloud-store.mjs';
import { createDeviceCloudDeletionWorker } from './_shared/device-cloud-maintenance-data.mjs';
import { createNetlifySnapshotObjects } from './_shared/device-cloud-objects.mjs';

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

export default createDeviceCloudDeletionWorker({
  enabled: environment('NEXORA_DEVICE_CLOUD_ENABLED') === 'true'
    && environment('NEXORA_DEVICE_CLOUD_MAINTENANCE_ENABLED') === 'true',
  getStore,
  getSnapshotObjects: createNetlifySnapshotObjects,
  limit: 3,
  onError(error) {
    console.error('[device-cloud-maintenance]', {
      name: String(error?.name || 'Error').slice(0, 80),
      code: String(error?.code || 'unknown').slice(0, 80),
      message: String(error?.message || 'maintenance failed').slice(0, 160)
    });
  }
});

export const config = {
  schedule: '@hourly'
};
