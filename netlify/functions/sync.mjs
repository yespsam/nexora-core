import { getStore } from '@netlify/blobs';

import {
  MAX_SYNC_BODY_BYTES,
  SYNC_STORE_NAME,
  createSyncRecord,
  matchesSyncAccessToken,
  normalizeEncryptedSyncPayload,
  normalizeSyncAccessToken,
  normalizeSyncBaseRevision,
  normalizeSyncId,
  normalizeSyncRecord
} from './sync-data.mjs';

function json(body, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff'
    }
  });
}

function recordKey(id) {
  return `companion/${id}`;
}

async function readRecord(store, id) {
  return normalizeSyncRecord(await store.get(recordKey(id), { type: 'json' }));
}

export default async function handler(request) {
  const url = new URL(request.url);
  const token = normalizeSyncAccessToken(request.headers.get('x-nexora-sync-token'));
  const queryId = normalizeSyncId(url.searchParams.get('id'));
  if (!token) return json({ error: 'unauthorized' }, 401);

  const store = getStore({ name: SYNC_STORE_NAME, consistency: 'strong' });

  try {
    if (request.method === 'GET') {
      if (!queryId) return json({ error: 'invalid request' }, 400);
      const record = await readRecord(store, queryId);
      if (!record || !matchesSyncAccessToken(token, record.tokenHash)) return json({ error: 'not found' }, 404);
      return json({
        version: record.version,
        revision: record.revision,
        payload: record.payload
      });
    }

    if (request.method === 'DELETE') {
      if (!queryId) return json({ error: 'invalid request' }, 400);
      const record = await readRecord(store, queryId);
      if (!record || !matchesSyncAccessToken(token, record.tokenHash)) return json({ error: 'not found' }, 404);
      await store.delete(recordKey(queryId));
      return json({ deleted: true });
    }

    if (request.method !== 'PUT') return json({ error: 'method not allowed' }, 405);

    const contentLength = Number(request.headers.get('content-length') || 0);
    if (contentLength > MAX_SYNC_BODY_BYTES) return json({ error: 'payload too large' }, 413);
    const text = await request.text();
    if (new TextEncoder().encode(text).byteLength > MAX_SYNC_BODY_BYTES) {
      return json({ error: 'payload too large' }, 413);
    }
    let body;
    try {
      body = JSON.parse(text);
    } catch (error) {
      return json({ error: 'invalid json' }, 400);
    }

    const id = normalizeSyncId(body.id);
    const payload = normalizeEncryptedSyncPayload(body.payload);
    const baseRevision = normalizeSyncBaseRevision(body.baseRevision);
    if (!id || !payload || baseRevision === null) return json({ error: 'invalid request' }, 400);

    const current = await readRecord(store, id);
    if (current && !matchesSyncAccessToken(token, current.tokenHash)) return json({ error: 'not found' }, 404);
    if ((current?.revision || 0) !== baseRevision) {
      return json({ error: 'conflict', revision: current?.revision || 0 }, 409);
    }
    const record = createSyncRecord({
      token,
      revision: baseRevision + 1,
      payload
    });
    if (!record) return json({ error: 'invalid request' }, 400);
    await store.setJSON(recordKey(id), record);
    return json({ saved: true, revision: record.revision });
  } catch (error) {
    return json({ error: 'sync temporarily unavailable' }, 503);
  }
}

export const config = {
  path: '/api/sync',
  method: ['GET', 'PUT', 'DELETE'],
  rateLimit: {
    windowLimit: 60,
    windowSize: 60,
    aggregateBy: ['ip', 'domain']
  }
};
