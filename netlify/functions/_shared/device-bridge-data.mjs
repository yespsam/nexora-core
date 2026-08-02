import { DeviceCloudError } from '../../../cloud/device-cloud-validation.mjs';

const maximumBodyBytes = 24000;
const secretPattern = /^[A-Za-z0-9_-]{43}$/;

function json(body, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'Vary': 'Authorization',
      'X-Content-Type-Options': 'nosniff'
    }
  });
}

function bearerToken(request) {
  const match = String(request.headers.get('authorization') || '').match(/^Bearer ([A-Za-z0-9_-]{43})$/);
  if (!match || !secretPattern.test(match[1])) throw new DeviceCloudError('unauthorized', 401, 'unauthorized');
  return match[1];
}

async function readJson(request) {
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > maximumBodyBytes) {
    throw new DeviceCloudError('payload too large', 413, 'payload_too_large');
  }
  try {
    return text ? JSON.parse(text) : {};
  } catch (error) {
    throw new DeviceCloudError('invalid json');
  }
}

function publicError(error) {
  if (error instanceof DeviceCloudError) return error;
  return new DeviceCloudError('device bridge unavailable', 503, 'unavailable');
}

function forwardedJsonRequest(request, path, body) {
  return new Request(new URL(path, request.url), {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'X-Nexora-Client-Release': 'desktop-pet-native-v1'
    },
    body: JSON.stringify(body)
  });
}

export function createDeviceBridgeFunction(options) {
  const enabled = options.enabled === true;
  const getStore = options.getStore;
  const onError = options.onError || (() => {});
  const handleChat = options.handleChat;
  const handleVoice = options.handleVoice;

  return async function deviceBridgeHandler(request) {
    if (!enabled) return json({ error: 'not_found' }, 404);
    try {
      const url = new URL(request.url);
      const agentId = url.searchParams.get('agentId');
      const store = getStore();
      const auth = await store.authenticateCommandAgent(agentId, bearerToken(request));
      if (request.method === 'GET' && url.pathname === '/api/device-bridge/status') {
        return json({
          enabled: true,
          authenticated: true,
          agentId: auth.agentId,
          vaultId: auth.vaultId
        });
      }
      if (request.method === 'GET' && url.pathname === '/api/device-bridge/commands') {
        return json(await store.claimCommand(auth));
      }
      if (request.method === 'POST' && url.pathname === '/api/device-bridge/chat') {
        if (typeof handleChat !== 'function') {
          throw new DeviceCloudError('desktop chat unavailable', 503, 'chat_unavailable');
        }
        return handleChat(forwardedJsonRequest(request, '/api/chat', await readJson(request)));
      }
      if (request.method === 'POST' && url.pathname === '/api/device-bridge/voice') {
        if (typeof handleVoice !== 'function') {
          throw new DeviceCloudError('desktop voice unavailable', 503, 'voice_unavailable');
        }
        return handleVoice(await readJson(request));
      }
      const acknowledgement = url.pathname.match(/^\/api\/device-bridge\/commands\/([0-9a-f-]+)\/ack$/i);
      if (request.method === 'POST' && acknowledgement) {
        const body = await readJson(request);
        return json(await store.acknowledgeCommand(auth, acknowledgement[1], body.outcome));
      }
      throw new DeviceCloudError('not found', 404, 'not_found');
    } catch (caught) {
      const error = publicError(caught);
      if (error.status >= 500) onError(caught);
      return json({ error: error.code, message: error.message }, error.status);
    }
  };
}
