import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';

import { DeviceCloudStore } from './device-cloud-store.mjs';
import { DeviceCloudError, requiredUuid } from './device-cloud-validation.mjs';

const maximumBodyBytes = 400000;

function json(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'X-Content-Type-Options': 'nosniff'
  });
  response.end(body);
}

function matchesSecret(actual, expected) {
  const supplied = Buffer.from(String(actual || ''));
  const required = Buffer.from(String(expected || ''));
  return supplied.length === required.length && supplied.length > 0 && timingSafeEqual(supplied, required);
}

async function readJson(request) {
  const declaredLength = Number(request.headers['content-length'] || 0);
  if (declaredLength > maximumBodyBytes) throw new DeviceCloudError('payload too large', 413, 'payload_too_large');
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.byteLength;
    if (size > maximumBodyBytes) throw new DeviceCloudError('payload too large', 413, 'payload_too_large');
    chunks.push(chunk);
  }
  if (!size) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch (error) {
    throw new DeviceCloudError('invalid json');
  }
}

function databaseError(error) {
  if (error instanceof DeviceCloudError) return error;
  if (error?.code === '23505') return new DeviceCloudError('resource already exists', 409, 'conflict');
  if (error?.code === '23503' || error?.code === '23514' || error?.code === '22P02') {
    return new DeviceCloudError('database rejected invalid data');
  }
  return new DeviceCloudError('device cloud unavailable', 503, 'unavailable');
}

export function createDeviceCloudHttpServer(options = {}) {
  const apiKey = String(options.apiKey || process.env.NEXORA_LOCAL_API_KEY || randomBytes(32).toString('base64url'));
  if (apiKey.length < 32) throw new Error('NEXORA_LOCAL_API_KEY must contain at least 32 characters');
  const store = options.store || new DeviceCloudStore({
    subjectPepper: options.subjectPepper || process.env.NEXORA_SUBJECT_PEPPER || apiKey
  });
  const allowImmediateDeletion = options.allowImmediateDeletion ?? process.env.NODE_ENV !== 'production';

  const server = createServer(async (request, response) => {
    const url = new URL(request.url || '/', 'http://127.0.0.1');
    try {
      if (request.method === 'GET' && url.pathname === '/health') {
        return json(response, 200, await store.health());
      }
      if (!matchesSecret(request.headers['x-nexora-local-key'], apiKey)) {
        throw new DeviceCloudError('unauthorized', 401, 'unauthorized');
      }
      const ownerId = requiredUuid(request.headers['x-nexora-owner-id'], 'owner id');

      if (request.method === 'POST' && url.pathname === '/v1/bootstrap') {
        return json(response, 201, await store.bootstrap(ownerId, await readJson(request)));
      }
      if (request.method === 'POST' && url.pathname === '/v1/devices') {
        return json(response, 201, await store.registerDevice(ownerId, await readJson(request)));
      }
      if (request.method === 'POST' && url.pathname === '/v1/events') {
        return json(response, 201, await store.appendEvent(ownerId, await readJson(request)));
      }
      if (request.method === 'GET' && url.pathname === '/v1/events') {
        return json(response, 200, await store.listEvents(ownerId, {
          vaultId: url.searchParams.get('vaultId'),
          requesterDeviceId: url.searchParams.get('deviceId'),
          after: Number(url.searchParams.get('after') || 0),
          limit: Number(url.searchParams.get('limit') || 200)
        }));
      }
      const revokeMatch = url.pathname.match(/^\/v1\/devices\/([0-9a-f-]+)\/revoke$/i);
      if (request.method === 'POST' && revokeMatch) {
        return json(response, 200, await store.revokeDevice(ownerId, revokeMatch[1], await readJson(request)));
      }
      if (request.method === 'POST' && url.pathname === '/v1/recovery') {
        return json(response, 200, await store.recoverVaultEnvelope(ownerId, await readJson(request)));
      }
      if (request.method === 'POST' && url.pathname === '/v1/deletions') {
        const body = await readJson(request);
        if (body.immediate && !allowImmediateDeletion) {
          throw new DeviceCloudError('immediate deletion is disabled', 403, 'forbidden');
        }
        return json(response, 202, await store.scheduleDeletion(ownerId, body));
      }
      const deletionMatch = url.pathname.match(/^\/v1\/deletions\/([0-9a-f-]+)\/execute$/i);
      if (request.method === 'POST' && deletionMatch) {
        if (!allowImmediateDeletion) throw new DeviceCloudError('manual deletion is disabled', 403, 'forbidden');
        return json(response, 200, await store.executeDeletion(ownerId, deletionMatch[1]));
      }
      throw new DeviceCloudError('not found', 404, 'not_found');
    } catch (caught) {
      const error = databaseError(caught);
      if (error.status >= 500) console.error('[device-cloud]', caught);
      json(response, error.status, { error: error.code, message: error.message });
    }
  });

  return {
    apiKey,
    server,
    store,
    async listen(port = Number(process.env.NEXORA_CLOUD_PORT || 4788), host = '127.0.0.1') {
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, resolve);
      });
      const address = server.address();
      return `http://${host}:${address.port}`;
    },
    async close() {
      if (server.listening) await new Promise((resolve) => server.close(resolve));
      await store.close();
    }
  };
}

async function main() {
  const runtime = createDeviceCloudHttpServer();
  const url = await runtime.listen();
  console.log(`NEXORA local device cloud: ${url}`);
  console.log(`NEXORA_LOCAL_API_KEY=${runtime.apiKey}`);
  console.log('This development key is local-only and is not a production authentication system.');
  const shutdown = async () => {
    await runtime.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
