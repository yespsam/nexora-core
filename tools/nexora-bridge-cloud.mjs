import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

import {
  decryptDeviceCommandForAgent,
  parseDeviceCommandPairingCode
} from '../shared/device-command-cloud.mjs';
import { executeNexoraCommand } from './nexora-command-executor.mjs';

const productionSitePattern = /^https:\/\/(?:[a-z0-9-]+--)?nexora-core-staging\.netlify\.app$/i;
const localSitePattern = /^http:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?$/i;

export function normalizeNexoraCloudSite(value) {
  const site = String(value || 'https://product-private-cloud-staging--nexora-core-staging.netlify.app')
    .trim()
    .replace(/\/+$/g, '');
  return productionSitePattern.test(site) || localSitePattern.test(site) ? site : '';
}

export function createNexoraBridgeCloudConfig(pairingCode, options = {}) {
  const credential = parseDeviceCommandPairingCode(pairingCode);
  const siteUrl = normalizeNexoraCloudSite(options.siteUrl);
  if (!credential || !siteUrl) throw new Error('invalid NEXORA pairing configuration');
  return { version: 1, siteUrl, credential };
}

export async function saveNexoraBridgeCloudConfig(configValue, options = {}) {
  const config = createNexoraBridgeCloudConfig(
    options.pairingCode || [
      'NXC1',
      configValue?.credential?.agentId,
      configValue?.credential?.vaultId,
      configValue?.credential?.secret
    ].join('.'),
    { siteUrl: configValue?.siteUrl }
  );
  const path = options.path || join(homedir(), '.nexora', 'bridge.json');
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.tmp`;
  await writeFile(temporary, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, path);
  return { path, config };
}

export async function loadNexoraBridgeCloudConfig(options = {}) {
  const path = options.path || join(homedir(), '.nexora', 'bridge.json');
  const parsed = JSON.parse(await readFile(path, 'utf8'));
  return createNexoraBridgeCloudConfig([
    'NXC1',
    parsed?.credential?.agentId,
    parsed?.credential?.vaultId,
    parsed?.credential?.secret
  ].join('.'), { siteUrl: parsed?.siteUrl });
}

async function responseJson(response) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(String(body.error || 'bridge_cloud_request_failed'));
  return body;
}

export function createNexoraCloudCommandPoller(options) {
  const config = createNexoraBridgeCloudConfig([
    'NXC1',
    options.config?.credential?.agentId,
    options.config?.credential?.vaultId,
    options.config?.credential?.secret
  ].join('.'), { siteUrl: options.config?.siteUrl });
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const execute = options.execute || ((command) => executeNexoraCommand(command, { mode: options.mode }));
  const intervalMs = Math.min(30000, Math.max(1000, Number(options.intervalMs) || 2500));
  let stopped = false;

  const request = (path, init = {}) => fetchImpl(`${config.siteUrl}${path}`, {
    cache: 'no-store',
    ...init,
    headers: {
      'Accept': 'application/json',
      'Authorization': `Bearer ${config.credential.secret}`,
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers || {})
    }
  });

  async function pollOnce() {
    const suffix = `?agentId=${encodeURIComponent(config.credential.agentId)}`;
    const claimed = await responseJson(await request(`/api/device-bridge/commands${suffix}`));
    if (!claimed.command) return { status: 'idle' };
    const commandId = String(claimed.command.commandId || '');
    let execution;
    try {
      if (Date.parse(claimed.command.expiresAt || '') <= Date.now()) throw new Error('expired');
      const command = await decryptDeviceCommandForAgent(claimed.command, config.credential);
      execution = await execute(command);
    } catch (error) {
      execution = { ok: false, status: 'failed', summary: '指令验证或解密失败' };
    }
    const outcome = execution.ok ? 'acknowledged' : 'failed';
    await responseJson(await request(
      `/api/device-bridge/commands/${encodeURIComponent(commandId)}/ack${suffix}`,
      { method: 'POST', body: JSON.stringify({ outcome }) }
    ));
    return { status: outcome, commandId, execution };
  }

  async function run() {
    while (!stopped) {
      try {
        await pollOnce();
      } catch (error) {
        options.onError?.(error);
      }
      if (!stopped) await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }

  return {
    config,
    pollOnce,
    run,
    stop() { stopped = true; }
  };
}
