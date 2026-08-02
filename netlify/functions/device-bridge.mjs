import { getDatabase } from '@netlify/database';

import { DeviceCloudStore } from '../../cloud/device-cloud-store.mjs';
import { createDeviceBridgeFunction } from './_shared/device-bridge-data.mjs';
import chatHandler from './chat.mjs';
import { createVoiceResponse } from './voice-speak.mjs';

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

export default createDeviceBridgeFunction({
  enabled: environment('NEXORA_DEVICE_CLOUD_ENABLED') === 'true',
  getStore,
  handleChat: chatHandler,
  handleVoice: createVoiceResponse,
  onError(error) {
    console.error('[device-bridge-function]', {
      name: String(error?.name || 'Error').slice(0, 80),
      code: String(error?.code || 'unknown').slice(0, 80),
      message: String(error?.message || 'device bridge unavailable').slice(0, 200)
    });
  }
});

export const config = {
  path: '/api/device-bridge/*',
  method: ['GET', 'POST'],
  rateLimit: {
    windowLimit: 180,
    windowSize: 60,
    aggregateBy: ['ip', 'domain']
  }
};
