import { createServer } from 'node:http';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

import { normalizeDeviceCommand } from '../shared/device-command.mjs';
import {
  createNexoraBridgeCloudConfig,
  createNexoraCloudCommandPoller,
  loadNexoraBridgeCloudConfig,
  saveNexoraBridgeCloudConfig
} from './nexora-bridge-cloud.mjs';
import { executeNexoraCommand } from './nexora-command-executor.mjs';

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

export async function startNexoraBridge({ host = '127.0.0.1', port = 8765, mode = 'simulation' } = {}) {
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
        mode: mode === 'native' ? 'native' : 'simulation',
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
        const execution = await executeNexoraCommand(command, { mode });
        const event = {
          id: `bridge-${Date.now().toString(36)}-${String(events.length + 1).padStart(3, '0')}`,
          status: execution.status,
          target: command.target,
          action: command.action,
          parameters: command.parameters,
          summary: command.label,
          createdAt: new Date().toISOString()
        };
        events.push(event);
        sendJson(request, response, execution.ok ? 200 : 422, { ok: execution.ok, ...event });
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

async function main() {
  const args = process.argv.slice(2);
  const pairingIndex = args.indexOf('--pair');
  if (pairingIndex >= 0) {
    let pairingCode = args[pairingIndex + 1];
    if (!pairingCode && process.stdin.isTTY) {
      const input = createInterface({ input: process.stdin, output: process.stdout });
      try {
        pairingCode = await input.question('Paste the NEXORA pairing code: ');
      } finally {
        input.close();
      }
    }
    if (!pairingCode) throw new Error('usage: npm run bridge:pair -- <pairing-code>');
    const config = createNexoraBridgeCloudConfig(pairingCode, {
      siteUrl: process.env.NEXORA_CLOUD_URL
    });
    const saved = await saveNexoraBridgeCloudConfig(config);
    console.log(`NEXORA Bridge paired at ${saved.path}`);
    console.log(`Agent ${config.credential.agentId} is ready for encrypted commands.`);
    return;
  }

  const mode = args.includes('--native') ? 'native' : 'simulation';
  const bridge = await startNexoraBridge({ mode });
  let poller = null;
  if (args.includes('--cloud')) {
    const config = await loadNexoraBridgeCloudConfig();
    poller = createNexoraCloudCommandPoller({
      config,
      mode,
      onError(error) {
        console.error(`NEXORA cloud poll failed: ${String(error?.message || error).slice(0, 120)}`);
      }
    });
    void poller.run();
    console.log(`NEXORA encrypted cloud channel enabled for agent ${config.credential.agentId}`);
  }
  console.log(`NEXORA Bridge ${mode} listening at ${bridge.url}`);

  const shutdown = async () => {
    poller?.stop();
    await bridge.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(String(error?.message || error));
    process.exitCode = 1;
  });
}
