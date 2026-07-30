import { getStore } from '@netlify/blobs';

export const DEVICE_CLOUD_SNAPSHOT_STORE = 'nexora-device-cloud-snapshots-v1';

function bytes(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  return null;
}

export function snapshotNamespace(context = {}) {
  const deployContext = String(context?.deploy?.context || '').toLowerCase();
  return deployContext === 'production' ? 'production' : 'staging';
}

export function createNetlifySnapshotObjects() {
  const store = getStore({ name: DEVICE_CLOUD_SNAPSHOT_STORE, consistency: 'strong' });
  return {
    async put(key, value) {
      const data = bytes(value);
      if (!data) throw new Error('snapshot object must contain bytes');
      await store.set(key, data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength), {
        metadata: { contentType: 'application/octet-stream', encrypted: true }
      });
    },
    async get(key) {
      const value = await store.get(key, { type: 'arrayBuffer' });
      return value == null ? null : new Uint8Array(value);
    },
    async delete(key) {
      await store.delete(key);
    },
    async deleteMany(keys) {
      for (let index = 0; index < keys.length; index += 10) {
        await Promise.all(keys.slice(index, index + 10).map((key) => store.delete(key)));
      }
    }
  };
}

export function createMemorySnapshotObjects() {
  const values = new Map();
  return {
    values,
    async put(key, value) {
      const data = bytes(value);
      if (!data) throw new Error('snapshot object must contain bytes');
      values.set(key, new Uint8Array(data));
    },
    async get(key) {
      const value = values.get(key);
      return value ? new Uint8Array(value) : null;
    },
    async delete(key) {
      values.delete(key);
    },
    async deleteMany(keys) {
      for (const key of keys) values.delete(key);
    }
  };
}
