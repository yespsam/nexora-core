import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';

import { normalizeDeviceCommand } from '../shared/device-command.mjs';

const maximumBodyBytes = 8192;
const productionOrigin = /^https:\/\/(?:[a-z0-9-]+--)?nexora-core-staging\.netlify\.app$/i;
const localOrigin = /^https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?$/i;

function originAllowed(origin) {
  return !origin || productionOrigin.test(origin) || localOrigin.test(origin);
}

function corsHeaders(request) {
  const origin = String(request.headers.origin || '');
  return {
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Origin': originAllowed(origin) && origin ? origin : 'null',
    'Access-Control-Allow-Private-Network': 'true',
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
    'Vary': 'Origin'
  };
}

function sendJson(request, response, status, body) {
  response.writeHead(status, corsHeaders(request));
  response.end(JSON.stringify(body));
}

async function readJson(request) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maximumBodyBytes) throw new Error('payload_too_large');
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch (error) {
    throw new Error('invalid_json');
  }
}

export async function startNexoraBridge({ host = '127.0.0.1', port = 8765 } = {}) {
  const events = [];
  const server = createServer(async (request, response) => {
    const origin = String(request.headers.origin || '');
    if (!originAllowed(origin)) {
      sendJson(request, response, 403, { error: 'origin_not_allowed' });
      return;
    }
    if (request.method === 'OPTIONS') {
      response.writeHead(204, corsHeaders(request));
      response.end();
      return;
    }
    const url = new URL(request.url || '/', `http://${host}:${port}`);
    if (request.method === 'GET' && url.pathname === '/status') {
      sendJson(request, response, 200, {
        product: 'NEXORA Bridge',
        version: 1,
        mode: 'simulation',
        capabilities: ['computer', 'virtual-ble-home']
      });
      return;
    }
    if (request.method === 'GET' && url.pathname === '/events') {
      sendJson(request, response, 200, { events: events.slice(-50) });
      return;
    }
    if (request.method === 'POST' && url.pathname === '/commands') {
      try {
        const body = await readJson(request);
        const command = normalizeDeviceCommand(body.command);
        if (!command) {
          sendJson(request, response, 400, { error: 'invalid_command' });
          return;
        }
        const event = {
          id: `bridge-${Date.now().toString(36)}-${String(events.length + 1).padStart(3, '0')}`,
          status: 'simulated',
          target: command.target,
          action: command.action,
          parameters: command.parameters,
          summary: command.label,
          createdAt: new Date().toISOString()
        };
        events.push(event);
        sendJson(request, response, 200, { ok: true, ...event });
      } catch (error) {
        sendJson(request, response, error.message === 'payload_too_large' ? 413 : 400, {
          error: error.message === 'payload_too_large' ? 'payload_too_large' : 'invalid_json'
        });
      }
      return;
    }
    sendJson(request, response, 404, { error: 'not_found' });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });
  const address = server.address();
  return {
    server,
    events,
    url: `http://${host}:${address.port}`,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const bridge = await startNexoraBridge();
  console.log(`NEXORA Bridge simulation listening at ${bridge.url}`);
}
