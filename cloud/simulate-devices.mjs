import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';

import {
  canonicalDeviceCloudEvent
} from '../shared/device-cloud-protocol.mjs';
import {
  createDeviceCommandAgentCredential,
  decryptDeviceCommandForAgent,
  encryptDeviceCommandForAgent
} from '../shared/device-command-cloud.mjs';
import { parseDeviceCommand } from '../shared/device-command.mjs';
import {
  createDeviceCloudKeys,
  createRecoveryEnvelope,
  createVaultKey,
  fromBase64Url,
  toBase64Url,
  unwrapRecoveryEnvelope,
  wrapVaultKeyForDevice
} from '../shared/device-cloud-crypto.mjs';
import { createDeviceCloudHttpServer } from './local-server.mjs';
import { ownerIdForExternalSubject } from './device-cloud-identity.mjs';
import { DeviceCloudStore } from './device-cloud-store.mjs';
import { createDeviceCloudFunction } from '../netlify/functions/_shared/device-cloud-data.mjs';
import { createMemorySnapshotObjects } from '../netlify/functions/_shared/device-cloud-objects.mjs';

const crypto = globalThis.crypto;
const totalEvents = Math.max(12, Number(process.env.NEXORA_SIM_EVENT_COUNT || 1000));
const transport = process.env.NEXORA_SIM_TRANSPORT === 'netlify-function' ? 'netlify-function' : 'local-http';

function publicVaultId() {
  return randomBytes(16).toString('base64url');
}

async function device(name, type, vaultKey) {
  const keys = await createDeviceCloudKeys();
  return {
    id: randomUUID(),
    name,
    type,
    keys,
    keyVersion: 1,
    sequence: 0,
    previousEventHash: '',
    wrappedVaultKey: await wrapVaultKeyForDevice(vaultKey, keys.exchangePublicJwk)
  };
}

function registration(value) {
  return {
    id: value.id,
    type: value.type,
    displayName: value.name,
    signingKeyId: `device:${value.id}`,
    signingPublicJwk: value.keys.signingPublicJwk,
    exchangePublicJwk: value.keys.exchangePublicJwk,
    firmwareVersion: value.type === 'pendant' ? 'nc01-sim-1' : 'web-sim-1',
    wrappedVaultKey: value.wrappedVaultKey
  };
}

async function encryptedEvent(value, vaultId, index) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify({
    type: index % 5 === 0 ? 'memory.updated' : 'interaction.completed',
    companionName: '仅存在于密文中的名字',
    body: `${value.name} offline interaction ${index}`
  }));
  const ciphertext = await crypto.subtle.encrypt({
    name: 'AES-GCM',
    iv,
    additionalData: new TextEncoder().encode(`nexora-device-event-v1:${vaultId}`),
    tagLength: 128
  }, value.vaultKey, plaintext);
  const event = {
    version: 1,
    eventId: randomUUID(),
    vaultId,
    deviceId: value.id,
    deviceSequence: value.sequence + 1,
    occurredAt: new Date().toISOString(),
    keyVersion: value.keyVersion,
    previousEventHash: value.previousEventHash,
    payload: {
      algorithm: 'A256GCM',
      iv: toBase64Url(iv),
      ciphertext: toBase64Url(ciphertext)
    },
    auth: {
      algorithm: 'ES256',
      keyId: `device:${value.id}`,
      signature: 'A'.repeat(86)
    }
  };
  const canonical = canonicalDeviceCloudEvent(event);
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    value.keys.signing.privateKey,
    new TextEncoder().encode(canonical)
  );
  event.auth.signature = toBase64Url(signature);
  return event;
}

async function main() {
  const apiKey = randomBytes(32).toString('base64url');
  const subjectPepper = randomBytes(32).toString('base64url');
  const identityUserId = randomUUID();
  const externalSubject = transport === 'netlify-function'
    ? `netlify-identity:${identityUserId}`
    : `local-simulator:${identityUserId}`;
  const ownerId = ownerIdForExternalSubject(externalSubject, subjectPepper);
  const store = transport === 'netlify-function' ? new DeviceCloudStore({
    subjectPepper,
    apiRole: 'nexora_cloud_api',
    maintenanceRole: 'nexora_cloud_maintenance'
  }) : null;
  const functionSnapshotObjects = createMemorySnapshotObjects();
  const runtime = transport === 'local-http'
    ? createDeviceCloudHttpServer({ apiKey, subjectPepper, allowImmediateDeletion: true })
    : null;
  const activeStore = runtime?.store || store;
  const activeSnapshotObjects = runtime?.snapshotObjects || functionSnapshotObjects;
  const baseUrl = runtime ? await runtime.listen(0) : 'https://nexora-function.test';
  const vaultId = publicVaultId();
  let vaultKey = await createVaultKey();
  let recovery = await createRecoveryEnvelope(vaultKey);
  const devices = [
    await device('Phone Simulator', 'phone', vaultKey),
    await device('NC-01 Pendant Simulator', 'pendant', vaultKey),
    await device('Desktop Simulator', 'desktop', vaultKey)
  ];
  for (const value of devices) value.vaultKey = vaultKey;
  const [phone, pendant, desktop] = devices;
  let functionError;

  async function request(path, options = {}) {
    if (transport === 'netlify-function') {
      const handler = createDeviceCloudFunction({
        enabled: true,
        getStore: () => store,
        getCurrentUser: async () => ({ id: options.identityUserId || identityUserId }),
        verifyOrigin: () => {},
        subjectPepper,
        getSnapshotObjects: () => functionSnapshotObjects,
        getSnapshotNamespace: () => 'local-function',
        onError: (error) => { functionError = error; }
      });
      const functionPath = path.replace(/^\/v1/, '/api/device-cloud');
      const response = await handler(new Request(`${baseUrl}${functionPath}`, {
        method: options.method || 'GET',
        headers: { 'Content-Type': 'application/json', Origin: baseUrl },
        body: options.body === undefined ? undefined : JSON.stringify(options.body)
      }));
      const body = await response.json();
      if (response.status >= 500 && functionError) throw functionError;
      return { status: response.status, body };
    }
    const response = await fetch(`${baseUrl}${path}`, {
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        'X-Nexora-Local-Key': apiKey,
        'X-Nexora-Owner-Id': options.ownerId || ownerId
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body)
    });
    const body = await response.json();
    return { status: response.status, body };
  }

  async function append(value, index) {
    const event = await encryptedEvent(value, vaultId, index);
    const response = await request('/v1/events', { method: 'POST', body: event });
    assert.equal(response.status, 201, JSON.stringify(response.body));
    value.sequence += 1;
    value.previousEventHash = response.body.contentHash;
    return event;
  }

  try {
    const bootstrap = await request('/v1/bootstrap', {
      method: 'POST',
      body: {
        externalSubject,
        region: 'local',
        vaultId,
        device: registration(phone),
        recovery: {
          recoveryKeyId: recovery.recoveryKeyId,
          wrappedVaultKey: recovery.wrappedVaultKey
        }
      }
    });
    assert.equal(bootstrap.status, 201, JSON.stringify(bootstrap.body));
    for (const value of [pendant, desktop]) {
      const registered = await request('/v1/devices', {
        method: 'POST',
        body: { vaultId, device: registration(value) }
      });
      assert.equal(registered.status, 201, JSON.stringify(registered.body));
    }

    const commandAgent = await createDeviceCommandAgentCredential(vaultId);
    await activeStore.registerCommandAgent(ownerId, commandAgent.registration);
    const encryptedCommand = await encryptDeviceCommandForAgent(
      parseDeviceCommand('把电脑音量调到35'),
      commandAgent.credential
    );
    const queuedCommand = await activeStore.queueCommand(ownerId, encryptedCommand);
    const authenticatedAgent = await activeStore.authenticateCommandAgent(
      commandAgent.credential.agentId,
      commandAgent.credential.secret
    );
    const claimedCommand = await activeStore.claimCommand(authenticatedAgent);
    assert.equal(claimedCommand.command.commandId, queuedCommand.commandId);
    const decryptedCommand = await decryptDeviceCommandForAgent(
      claimedCommand.command,
      commandAgent.credential
    );
    assert.equal(decryptedCommand.action, 'volume.set');
    await activeStore.acknowledgeCommand(authenticatedAgent, queuedCommand.commandId, 'acknowledged');
    const commandStatus = await activeStore.commandStatus(ownerId, queuedCommand.commandId);
    assert.equal(commandStatus.status, 'acknowledged');

    const firstEvent = await append(phone, 0);
    const counts = [Math.ceil(totalEvents / 3), Math.floor(totalEvents / 3), Math.floor(totalEvents / 3)];
    while (counts.reduce((sum, count) => sum + count, 0) < totalEvents) counts[1] += 1;
    counts[0] -= 1;
    let index = 1;
    while (counts.some((count) => count > 0)) {
      const round = [];
      for (let deviceIndex = 0; deviceIndex < devices.length; deviceIndex += 1) {
        if (counts[deviceIndex] <= 0) continue;
        counts[deviceIndex] -= 1;
        round.push(append(devices[deviceIndex], index));
        index += 1;
      }
      await Promise.all(round);
    }
    assert.equal(devices.reduce((sum, value) => sum + value.sequence, 0), totalEvents);

    const duplicate = await request('/v1/events', { method: 'POST', body: firstEvent });
    assert.equal(duplicate.status, 201);
    assert.equal(duplicate.body.duplicate, true);

    const downloaded = [];
    let after = 0;
    do {
      const page = await request(`/v1/events?vaultId=${vaultId}&deviceId=${phone.id}&after=${after}&limit=137`);
      assert.equal(page.status, 200, JSON.stringify(page.body));
      downloaded.push(...page.body.events);
      after = page.body.nextCursor;
      if (!page.body.hasMore) break;
    } while (true);
    assert.equal(downloaded.length, totalEvents);
    assert.doesNotMatch(JSON.stringify(downloaded), /仅存在于密文中的名字/);
    assert.equal(new Set(downloaded.map((event) => event.eventId)).size, totalEvents);

    const snapshotCursor = downloaded.at(-1).cursor;
    let snapshotPlaintext;
    let latestSnapshotBody;
    for (let offset = 4; offset >= 0; offset -= 1) {
      const throughCursor = snapshotCursor - offset;
      snapshotPlaintext = new TextEncoder().encode(JSON.stringify({
        version: 1,
        companionName: '仅存在于快照密文中的名字',
        memories: ['offline snapshot round trip'],
        throughCursor
      }));
      const snapshotIv = crypto.getRandomValues(new Uint8Array(12));
      const snapshotCiphertext = await crypto.subtle.encrypt({
        name: 'AES-GCM',
        iv: snapshotIv,
        additionalData: new TextEncoder().encode(
          `nexora-device-snapshot-v1:${vaultId}:1:${throughCursor}`
        ),
        tagLength: 128
      }, vaultKey, snapshotPlaintext);
      latestSnapshotBody = {
        vaultId,
        deviceId: phone.id,
        throughCursor,
        keyVersion: 1,
        payload: {
          algorithm: 'A256GCM',
          iv: toBase64Url(snapshotIv),
          ciphertext: toBase64Url(snapshotCiphertext)
        }
      };
      const snapshot = await request('/v1/snapshots', { method: 'POST', body: latestSnapshotBody });
      assert.equal(snapshot.status, 201, JSON.stringify(snapshot.body));
      assert.equal(snapshot.body.duplicate, false);
    }
    assert.equal(activeSnapshotObjects.values.size, 3);
    const duplicateSnapshot = await request('/v1/snapshots', {
      method: 'POST',
      body: latestSnapshotBody
    });
    assert.equal(duplicateSnapshot.status, 201, JSON.stringify(duplicateSnapshot.body));
    assert.equal(duplicateSnapshot.body.duplicate, true);
    assert.equal(activeSnapshotObjects.values.size, 3);
    const latestSnapshot = await request(
      `/v1/snapshots/latest?vaultId=${vaultId}&deviceId=${phone.id}`
    );
    assert.equal(latestSnapshot.status, 200, JSON.stringify(latestSnapshot.body));
    assert.doesNotMatch(JSON.stringify(latestSnapshot.body), /仅存在于快照密文中的名字/);
    const decryptedSnapshot = await crypto.subtle.decrypt({
      name: 'AES-GCM',
      iv: fromBase64Url(latestSnapshot.body.payload.iv, 12, 12),
      additionalData: new TextEncoder().encode(
        `nexora-device-snapshot-v1:${vaultId}:1:${snapshotCursor}`
      ),
      tagLength: 128
    }, vaultKey, fromBase64Url(latestSnapshot.body.payload.ciphertext, 17, 262144));
    assert.deepEqual(new Uint8Array(decryptedSnapshot), snapshotPlaintext);

    const foreignOwner = await request(`/v1/events?vaultId=${vaultId}&deviceId=${phone.id}`, {
      ownerId: randomUUID(),
      identityUserId: randomUUID()
    });
    assert.equal(foreignOwner.status, 404);

    const nextVaultKey = await createVaultKey();
    const nextRecovery = await createRecoveryEnvelope(nextVaultKey, recovery.recoverySecret);
    const nextEnvelopes = [];
    for (const value of [phone, desktop]) {
      nextEnvelopes.push({
        deviceId: value.id,
        wrappedVaultKey: await wrapVaultKeyForDevice(nextVaultKey, value.keys.exchangePublicJwk)
      });
    }
    const revoked = await request(`/v1/devices/${pendant.id}/revoke`, {
      method: 'POST',
      body: {
        vaultId,
        nextKeyVersion: 2,
        envelopes: nextEnvelopes,
        recovery: {
          recoveryKeyId: nextRecovery.recoveryKeyId,
          wrappedVaultKey: nextRecovery.wrappedVaultKey
        }
      }
    });
    assert.equal(revoked.status, 200, JSON.stringify(revoked.body));
    for (const value of [phone, desktop]) {
      value.vaultKey = nextVaultKey;
      value.keyVersion = 2;
    }
    vaultKey = nextVaultKey;
    recovery = nextRecovery;

    const revokedEvent = await encryptedEvent(pendant, vaultId, totalEvents + 1);
    const blockedWrite = await request('/v1/events', { method: 'POST', body: revokedEvent });
    assert.equal(blockedWrite.status, 403);
    assert.equal(blockedWrite.body.error, 'device_revoked');
    const blockedRead = await request(`/v1/events?vaultId=${vaultId}&deviceId=${pendant.id}`);
    assert.equal(blockedRead.status, 403);

    const recovered = await request('/v1/recovery', {
      method: 'POST',
      body: { vaultId, recoveryKeyId: recovery.recoveryKeyId }
    });
    assert.equal(recovered.status, 200, JSON.stringify(recovered.body));
    assert.equal(recovered.body.keyVersion, 2);
    const recoveredKey = await unwrapRecoveryEnvelope(recovered.body.wrappedVaultKey, recovery.recoverySecret);
    const [expectedRawKey, actualRawKey] = await Promise.all([
      crypto.subtle.exportKey('raw', vaultKey),
      crypto.subtle.exportKey('raw', recoveredKey)
    ]);
    assert.equal(Buffer.from(actualRawKey).equals(Buffer.from(expectedRawKey)), true);

    const cancellableDeletion = await request('/v1/deletions', {
      method: 'POST',
      body: { scope: 'vault', vaultId }
    });
    assert.equal(cancellableDeletion.status, 202, JSON.stringify(cancellableDeletion.body));
    const cancelled = await request(`/v1/deletions/${cancellableDeletion.body.requestId}/cancel`, {
      method: 'POST',
      body: {}
    });
    assert.equal(cancelled.status, 200, JSON.stringify(cancelled.body));
    assert.equal(cancelled.body.status, 'cancelled');

    const failedObjectDeletion = await activeStore.scheduleDeletion(ownerId, {
      scope: 'vault',
      vaultId,
      immediate: true
    });
    await new Promise((resolve) => setTimeout(resolve, 1100));
    await assert.rejects(
      activeStore.executeDeletion(ownerId, failedObjectDeletion.requestId, {
        deleteObjects: async () => { throw new Error('simulated object store outage'); }
      }),
      (error) => error?.code === 'snapshot_delete_failed'
    );
    const snapshotAfterFailedDeletion = await request(
      `/v1/snapshots/latest?vaultId=${vaultId}&deviceId=${phone.id}`
    );
    assert.equal(snapshotAfterFailedDeletion.status, 200, JSON.stringify(snapshotAfterFailedDeletion.body));

    const deletion = transport === 'netlify-function'
      ? {
          status: 202,
          body: await store.scheduleDeletion(ownerId, { scope: 'account', immediate: true })
        }
      : await request('/v1/deletions', {
          method: 'POST',
          body: { scope: 'account', immediate: true }
    });
    assert.equal(deletion.status, 202, JSON.stringify(deletion.body));
    await new Promise((resolve) => setTimeout(resolve, 1100));
    const dueDeletions = await activeStore.listDueDeletions(10);
    assert.ok(dueDeletions.some((entry) => entry.requestId === deletion.body.requestId));
    const deleted = transport === 'netlify-function'
      ? {
          status: 200,
          body: await store.executeDeletion(ownerId, deletion.body.requestId, {
            deleteObjects: (keys) => activeSnapshotObjects.deleteMany(keys)
          })
        }
      : await request(`/v1/deletions/${deletion.body.requestId}/execute`, {
        method: 'POST',
        body: {}
      });
    assert.equal(deleted.status, 200, JSON.stringify(deleted.body));
    assert.equal(deleted.body.status, 'complete');
    assert.equal(activeSnapshotObjects.values.size, 0);
    const afterDeletion = await request('/v1/recovery', {
      method: 'POST',
      body: { vaultId, recoveryKeyId: recovery.recoveryKeyId }
    });
    assert.equal(afterDeletion.status, 404);

    const report = {
      passed: true,
      database: (await (runtime?.store || store).health()).database,
      transport,
      virtualDevices: devices.length,
      encryptedDesktopCommand: 'acknowledged',
      encryptedEvents: totalEvents,
      duplicateDelivery: 'idempotent',
      tenantIsolation: 'passed',
      revokedDeviceWrite: 'blocked',
      revokedDeviceRead: 'blocked',
      recoveryKeyRoundTrip: createHash('sha256').update(Buffer.from(actualRawKey)).digest('hex')
        === createHash('sha256').update(Buffer.from(expectedRawKey)).digest('hex'),
      encryptedSnapshotRoundTrip: 'passed',
      snapshotRetentionCompaction: 'passed',
      deletionCancellation: 'passed',
      deletionFailureRollback: 'passed',
      scheduledDeletionDiscovery: 'passed',
      snapshotObjectDeletion: 'passed',
      accountDeletion: 'complete'
    };
    console.log(JSON.stringify(report, null, 2));
  } finally {
    if (runtime) await runtime.close();
    else await store.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
