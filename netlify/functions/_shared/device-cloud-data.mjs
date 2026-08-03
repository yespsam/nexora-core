import { ownerIdForExternalSubject } from '../../../cloud/device-cloud-identity.mjs';
import { DeviceCloudError } from '../../../cloud/device-cloud-validation.mjs';

const maximumBodyBytes = 400000;

function json(body, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'Vary': 'Cookie',
      'X-Content-Type-Options': 'nosniff'
    }
  });
}

async function readJson(request) {
  const declaredLength = Number(request.headers.get('content-length') || 0);
  if (declaredLength > maximumBodyBytes) throw new DeviceCloudError('payload too large', 413, 'payload_too_large');
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > maximumBodyBytes) {
    throw new DeviceCloudError('payload too large', 413, 'payload_too_large');
  }
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new DeviceCloudError('invalid json');
  }
}

function publicError(error) {
  if (error instanceof DeviceCloudError) return error;
  if (error?.code === '23505') return new DeviceCloudError('resource already exists', 409, 'conflict');
  if (error?.code === '23503' || error?.code === '23514' || error?.code === '22P02') {
    return new DeviceCloudError('database rejected invalid data');
  }
  return new DeviceCloudError('device cloud unavailable', 503, 'unavailable');
}

export function createDeviceCloudFunction(options) {
  const enabled = options.enabled === true;
  const getStore = options.getStore;
  const getCurrentUser = options.getCurrentUser;
  const verifyOrigin = options.verifyOrigin;
  const subjectPepper = String(options.subjectPepper || '');
  const onError = options.onError || (() => {});
  const getSnapshotObjects = options.getSnapshotObjects || (() => null);
  const getSnapshotNamespace = options.getSnapshotNamespace || (() => 'staging');
  const dualWriteEnabled = options.dualWriteEnabled === true;

  return async function deviceCloudHandler(request, context = {}) {
    if (!enabled) return json({ error: 'not_found' }, 404);
    try {
      const user = await getCurrentUser();
      const userId = String(user?.id || '');
      if (!userId) throw new DeviceCloudError('unauthorized', 401, 'unauthorized');
      if (request.method !== 'GET') {
        try {
          verifyOrigin(request);
        } catch (error) {
          throw new DeviceCloudError('invalid request origin', 403, 'invalid_origin');
        }
      }
      const externalSubject = `netlify-identity:${userId}`;
      const ownerId = ownerIdForExternalSubject(externalSubject, subjectPepper);
      const store = getStore();
      const url = new URL(request.url);
      const path = url.pathname;

      if (request.method === 'GET' && path === '/api/device-cloud/status') {
        return json({ enabled: true, authenticated: true, dualWrite: dualWriteEnabled });
      }
      if (request.method === 'POST' && path === '/api/device-cloud/bootstrap') {
        const body = await readJson(request);
        return json(await store.bootstrap(ownerId, { ...body, externalSubject }), 201);
      }
      if (request.method === 'POST' && path === '/api/device-cloud/devices') {
        return json(await store.registerDevice(ownerId, await readJson(request)), 201);
      }
      if (request.method === 'POST' && path === '/api/device-cloud/command-agents') {
        return json(await store.registerCommandAgent(ownerId, await readJson(request)), 201);
      }
      const commandAgentMatch = path.match(/^\/api\/device-cloud\/command-agents\/([0-9a-f-]+)$/i);
      if (request.method === 'GET' && commandAgentMatch) {
        return json(await store.commandAgentStatus(ownerId, {
          agentId: commandAgentMatch[1],
          vaultId: url.searchParams.get('vaultId')
        }));
      }
      const commandAgentRevokeMatch = path.match(
        /^\/api\/device-cloud\/command-agents\/([0-9a-f-]+)\/revoke$/i
      );
      if (request.method === 'POST' && commandAgentRevokeMatch) {
        const body = await readJson(request);
        return json(await store.revokeCommandAgent(ownerId, {
          agentId: commandAgentRevokeMatch[1],
          vaultId: body.vaultId
        }));
      }
      if (request.method === 'POST' && path === '/api/device-cloud/commands') {
        return json(await store.queueCommand(ownerId, await readJson(request)), 202);
      }
      const commandMatch = path.match(/^\/api\/device-cloud\/commands\/([0-9a-f-]+)$/i);
      if (request.method === 'GET' && commandMatch) {
        return json(await store.commandStatus(ownerId, commandMatch[1]));
      }
      if (request.method === 'POST' && path === '/api/device-cloud/events') {
        return json(await store.appendEvent(ownerId, await readJson(request)), 201);
      }
      if (request.method === 'GET' && path === '/api/device-cloud/events') {
        return json(await store.listEvents(ownerId, {
          vaultId: url.searchParams.get('vaultId'),
          requesterDeviceId: url.searchParams.get('deviceId'),
          after: Number(url.searchParams.get('after') || 0),
          limit: Number(url.searchParams.get('limit') || 200)
        }));
      }
      if (request.method === 'POST' && path === '/api/device-cloud/snapshots') {
        return json(await store.createSnapshot(ownerId, await readJson(request), {
          objects: getSnapshotObjects(context),
          namespace: getSnapshotNamespace(context)
        }), 201);
      }
      if (request.method === 'GET' && path === '/api/device-cloud/snapshots/latest') {
        return json(await store.latestSnapshot(ownerId, {
          vaultId: url.searchParams.get('vaultId'),
          requesterDeviceId: url.searchParams.get('deviceId')
        }, { objects: getSnapshotObjects(context) }));
      }
      const revokeMatch = path.match(/^\/api\/device-cloud\/devices\/([0-9a-f-]+)\/revoke$/i);
      if (request.method === 'POST' && revokeMatch) {
        return json(await store.revokeDevice(ownerId, revokeMatch[1], await readJson(request)));
      }
      if (request.method === 'POST' && path === '/api/device-cloud/recovery') {
        return json(await store.recoverVaultEnvelope(ownerId, await readJson(request)));
      }
      if (request.method === 'POST' && path === '/api/device-cloud/deletions') {
        const body = await readJson(request);
        return json(await store.scheduleDeletion(ownerId, { ...body, immediate: false }), 202);
      }
      const cancelDeletionMatch = path.match(/^\/api\/device-cloud\/deletions\/([0-9a-f-]+)\/cancel$/i);
      if (request.method === 'POST' && cancelDeletionMatch) {
        return json(await store.cancelDeletion(ownerId, cancelDeletionMatch[1]));
      }
      throw new DeviceCloudError('not found', 404, 'not_found');
    } catch (caught) {
      const error = publicError(caught);
      if (error.status >= 500) onError(caught);
      return json({ error: error.code, message: error.message }, error.status);
    }
  };
}
