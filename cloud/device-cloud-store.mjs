import {
  createHash,
  createPublicKey,
  randomBytes,
  randomUUID,
  verify as verifySignature
} from 'node:crypto';

import pg from 'pg';

import {
  canonicalDeviceCloudEvent,
  normalizeDeviceCloudEvent
} from '../shared/device-cloud-protocol.mjs';
import { fromBase64Url, toBase64Url } from '../shared/device-cloud-crypto.mjs';
import { externalSubjectHash, ownerIdForExternalSubject } from './device-cloud-identity.mjs';
import {
  DeviceCloudError,
  normalizeDevice,
  normalizeRecoveryEnvelope,
  requiredUuid,
  requiredVaultId,
  wrappedKey
} from './device-cloud-validation.mjs';

const { Pool } = pg;

function poolConfig(role, environmentName, options = {}) {
  const connectionString = options.connectionString || process.env[environmentName];
  const configuredMaximum = Number(options.max || process.env.NEXORA_CLOUD_POOL_MAX || 2);
  const max = Number.isSafeInteger(configuredMaximum)
    ? Math.min(8, Math.max(1, configuredMaximum))
    : 2;
  const common = {
    max,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 10000,
    query_timeout: 9000,
    statement_timeout: 8000,
    allowExitOnIdle: true,
    application_name: 'nexora-device-cloud'
  };
  if (connectionString) return { ...common, connectionString };
  return {
    ...common,
    database: process.env.NEXORA_CLOUD_DATABASE || 'nexora_core_dev',
    host: process.env.PGHOST || '/tmp',
    user: role
  };
}

async function withOwner(pool, ownerId, operation) {
  const owner = requiredUuid(ownerId, 'owner id');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.owner_id', $1, true)", [owner]);
    const result = await operation(client, owner);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function vaultForOwner(client, publicId, lock = false) {
  const result = await client.query(`
    SELECT id, public_id, active_key_version, status
    FROM nexora_cloud.companion_vaults
    WHERE public_id = $1
    ${lock ? 'FOR UPDATE' : ''}
  `, [requiredVaultId(publicId)]);
  if (!result.rowCount) throw new DeviceCloudError('vault not found', 404, 'not_found');
  return result.rows[0];
}

async function insertDevice(client, ownerId, vault, value, keyVersion) {
  const device = normalizeDevice(value);
  await client.query(`
    INSERT INTO nexora_cloud.devices (
      id, owner_id, vault_id, device_type, display_name, signing_key_id,
      signing_public_key_jwk, exchange_public_key_jwk, firmware_version
    ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9)
  `, [
    device.id,
    ownerId,
    vault.id,
    device.type,
    device.displayName,
    device.signingKeyId,
    JSON.stringify(device.signingPublicJwk),
    JSON.stringify(device.exchangePublicJwk),
    device.firmwareVersion
  ]);
  await client.query(`
    INSERT INTO nexora_cloud.device_key_envelopes (
      owner_id, vault_id, device_id, key_version, wrapping_algorithm, wrapped_vault_key
    ) VALUES ($1, $2, $3, $4, 'ECDH-ES+A256KW', $5)
  `, [ownerId, vault.id, device.id, keyVersion, device.wrappedVaultKey]);
  return device;
}

export class DeviceCloudStore {
  constructor(options = {}) {
    this.subjectPepper = String(
      options.subjectPepper
      || process.env.NEXORA_SUBJECT_PEPPER
      || randomBytes(32).toString('base64url')
    );
    if (this.subjectPepper.length < 32) throw new Error('NEXORA_SUBJECT_PEPPER must contain at least 32 characters');
    this.apiPool = options.apiPool || new Pool(poolConfig(
      'nexora_cloud_api',
      'NEXORA_CLOUD_API_DATABASE_URL',
      { connectionString: options.apiConnectionString, max: options.poolMax }
    ));
    this.maintenancePool = options.maintenancePool
      || new Pool(poolConfig(
        'nexora_cloud_maintenance',
        'NEXORA_CLOUD_MAINTENANCE_DATABASE_URL',
        { connectionString: options.maintenanceConnectionString, max: options.poolMax }
      ));
  }

  async health() {
    const result = await this.apiPool.query('SELECT current_database() AS database, now() AS now');
    return { ok: true, database: result.rows[0].database, time: result.rows[0].now.toISOString() };
  }

  async bootstrap(ownerId, value) {
    const publicId = requiredVaultId(value?.vaultId);
    const externalSubject = String(value?.externalSubject || '');
    if (externalSubject.length < 8 || externalSubject.length > 200) {
      throw new DeviceCloudError('invalid external subject');
    }
    const region = String(value?.region || 'cn');
    if (!/^[a-z0-9-]{2,16}$/.test(region)) throw new DeviceCloudError('invalid region');
    const recovery = normalizeRecoveryEnvelope(value?.recovery);
    const vaultUuid = value?.vaultUuid ? requiredUuid(value.vaultUuid, 'vault uuid') : randomUUID();
    const expectedOwner = ownerIdForExternalSubject(externalSubject, this.subjectPepper);
    if (String(ownerId).toLowerCase() !== expectedOwner) {
      throw new DeviceCloudError('owner does not match authenticated subject', 403, 'owner_mismatch');
    }
    const subjectHash = externalSubjectHash(externalSubject, this.subjectPepper);

    return withOwner(this.apiPool, ownerId, async (client, owner) => {
      await client.query(`
        INSERT INTO nexora_cloud.accounts (id, external_subject_hash, region)
        VALUES ($1, $2, $3)
      `, [owner, subjectHash, region]);
      const vaultResult = await client.query(`
        INSERT INTO nexora_cloud.companion_vaults (id, owner_id, public_id)
        VALUES ($1, $2, $3)
        RETURNING id, public_id, active_key_version, status
      `, [vaultUuid, owner, publicId]);
      const vault = vaultResult.rows[0];
      const device = await insertDevice(client, owner, vault, value.device, 1);
      await client.query(`
        INSERT INTO nexora_cloud.recovery_key_envelopes (
          owner_id, vault_id, key_version, recovery_key_id, wrapping_algorithm, wrapped_vault_key
        ) VALUES ($1, $2, 1, $3, 'HKDF-SHA256+A256KW', $4)
      `, [owner, vault.id, recovery.recoveryKeyId, recovery.wrappedVaultKey]);
      return {
        ownerId: owner,
        vaultUuid: vault.id,
        vaultId: vault.public_id,
        keyVersion: vault.active_key_version,
        deviceId: device.id
      };
    });
  }

  async registerDevice(ownerId, value) {
    return withOwner(this.apiPool, ownerId, async (client, owner) => {
      const vault = await vaultForOwner(client, value?.vaultId, true);
      if (vault.status !== 'active') throw new DeviceCloudError('vault is not active', 409, 'vault_locked');
      const device = await insertDevice(client, owner, vault, value?.device, vault.active_key_version);
      return { deviceId: device.id, vaultId: vault.public_id, keyVersion: vault.active_key_version };
    });
  }

  async appendEvent(ownerId, value) {
    const event = normalizeDeviceCloudEvent(value);
    if (!event) throw new DeviceCloudError('invalid encrypted event');
    const canonical = canonicalDeviceCloudEvent(event);
    const contentHash = createHash('sha256').update(canonical).digest();

    return withOwner(this.apiPool, ownerId, async (client) => {
      const deviceResult = await client.query(`
        SELECT
          d.id, d.signing_key_id, d.signing_public_key_jwk, d.revoked_at,
          v.id AS vault_uuid, v.public_id, v.active_key_version, v.status
        FROM nexora_cloud.devices d
        JOIN nexora_cloud.companion_vaults v ON v.id = d.vault_id
        WHERE d.id = $1 AND v.public_id = $2
        FOR UPDATE OF d, v
      `, [event.deviceId, event.vaultId]);
      if (!deviceResult.rowCount) throw new DeviceCloudError('device not found', 404, 'not_found');
      const device = deviceResult.rows[0];
      if (device.revoked_at) throw new DeviceCloudError('device revoked', 403, 'device_revoked');
      if (device.status !== 'active') throw new DeviceCloudError('vault is not active', 409, 'vault_locked');
      if (device.signing_key_id !== event.auth.keyId) {
        throw new DeviceCloudError('signing key does not belong to device', 403, 'invalid_signature');
      }

      const publicKey = createPublicKey({ key: device.signing_public_key_jwk, format: 'jwk' });
      const signature = Buffer.from(fromBase64Url(event.auth.signature, 64, 64));
      const validSignature = verifySignature(
        'sha256',
        Buffer.from(canonical),
        { key: publicKey, dsaEncoding: 'ieee-p1363' },
        signature
      );
      if (!validSignature) throw new DeviceCloudError('invalid device signature', 403, 'invalid_signature');

      const duplicate = await client.query(`
        SELECT cursor, content_hash
        FROM nexora_cloud.companion_events
        WHERE event_id = $1 OR (device_id = $2 AND device_sequence = $3)
        LIMIT 1
      `, [event.eventId, event.deviceId, event.deviceSequence]);
      if (duplicate.rowCount) {
        if (!duplicate.rows[0].content_hash.equals(contentHash)) {
          throw new DeviceCloudError('event identity conflict', 409, 'event_conflict');
        }
        return { cursor: Number(duplicate.rows[0].cursor), duplicate: true };
      }

      if (event.keyVersion !== device.active_key_version) {
        throw new DeviceCloudError('stale vault key version', 409, 'stale_key');
      }
      const previous = await client.query(`
        SELECT device_sequence, content_hash
        FROM nexora_cloud.companion_events
        WHERE device_id = $1
        ORDER BY device_sequence DESC
        LIMIT 1
      `, [event.deviceId]);
      const expectedSequence = previous.rowCount ? Number(previous.rows[0].device_sequence) + 1 : 1;
      if (event.deviceSequence !== expectedSequence) {
        throw new DeviceCloudError('device sequence gap', 409, 'sequence_gap');
      }
      const expectedPreviousHash = previous.rowCount ? previous.rows[0].content_hash : null;
      const suppliedPreviousHash = event.previousEventHash
        ? Buffer.from(fromBase64Url(event.previousEventHash, 32, 32))
        : null;
      if (
        (expectedPreviousHash && !suppliedPreviousHash?.equals(expectedPreviousHash))
        || (!expectedPreviousHash && suppliedPreviousHash)
      ) throw new DeviceCloudError('event hash chain mismatch', 409, 'hash_chain_mismatch');

      const inserted = await client.query(`
        INSERT INTO nexora_cloud.companion_events (
          event_id, owner_id, vault_id, device_id, device_sequence, occurred_at,
          key_version, encryption_algorithm, iv, ciphertext, previous_event_hash,
          content_hash, signature_algorithm, signing_key_id, signature
        ) VALUES (
          $1, current_setting('app.owner_id')::uuid, $2, $3, $4, $5,
          $6, 'A256GCM', $7, $8, $9,
          $10, 'ES256', $11, $12
        )
        RETURNING cursor
      `, [
        event.eventId,
        device.vault_uuid,
        event.deviceId,
        event.deviceSequence,
        event.occurredAt,
        event.keyVersion,
        Buffer.from(fromBase64Url(event.payload.iv, 12, 12)),
        Buffer.from(fromBase64Url(event.payload.ciphertext, 17, 262144)),
        suppliedPreviousHash,
        contentHash,
        event.auth.keyId,
        signature
      ]);
      const cursor = Number(inserted.rows[0].cursor);
      await client.query(`
        UPDATE nexora_cloud.companion_vaults
        SET latest_event_cursor = GREATEST(latest_event_cursor, $1), updated_at = now()
        WHERE id = $2
      `, [cursor, device.vault_uuid]);
      return { cursor, duplicate: false, contentHash: toBase64Url(contentHash) };
    });
  }

  async listEvents(ownerId, { vaultId, requesterDeviceId, after = 0, limit = 200 }) {
    const publicId = requiredVaultId(vaultId);
    const deviceId = requiredUuid(requesterDeviceId, 'requester device id');
    const cursor = Number.isSafeInteger(Number(after)) && Number(after) >= 0 ? Number(after) : 0;
    const pageSize = Math.min(200, Math.max(1, Math.floor(Number(limit) || 200)));
    return withOwner(this.apiPool, ownerId, async (client) => {
      const vault = await vaultForOwner(client, publicId);
      const requester = await client.query(`
        SELECT 1 FROM nexora_cloud.devices
        WHERE id = $1 AND vault_id = $2 AND revoked_at IS NULL
      `, [deviceId, vault.id]);
      if (!requester.rowCount) throw new DeviceCloudError('device revoked or unknown', 403, 'device_revoked');
      const result = await client.query(`
        SELECT
          cursor, event_id, device_id, device_sequence, occurred_at, key_version,
          iv, ciphertext, previous_event_hash, content_hash, signing_key_id, signature
        FROM nexora_cloud.companion_events
        WHERE vault_id = $1 AND cursor > $2
        ORDER BY cursor ASC
        LIMIT $3
      `, [vault.id, cursor, pageSize]);
      const events = result.rows.map((row) => ({
        cursor: Number(row.cursor),
        version: 1,
        eventId: row.event_id,
        vaultId: publicId,
        deviceId: row.device_id,
        deviceSequence: Number(row.device_sequence),
        occurredAt: row.occurred_at.toISOString(),
        keyVersion: row.key_version,
        previousEventHash: row.previous_event_hash ? toBase64Url(row.previous_event_hash) : '',
        contentHash: toBase64Url(row.content_hash),
        payload: {
          algorithm: 'A256GCM',
          iv: toBase64Url(row.iv),
          ciphertext: toBase64Url(row.ciphertext)
        },
        auth: {
          algorithm: 'ES256',
          keyId: row.signing_key_id,
          signature: toBase64Url(row.signature)
        }
      }));
      return {
        events,
        nextCursor: events.at(-1)?.cursor || cursor,
        hasMore: events.length === pageSize
      };
    });
  }

  async revokeDevice(ownerId, targetDeviceId, value) {
    const targetId = requiredUuid(targetDeviceId, 'device id');
    const publicId = requiredVaultId(value?.vaultId);
    const envelopes = Array.isArray(value?.envelopes) ? value.envelopes : [];
    const recovery = normalizeRecoveryEnvelope(value?.recovery);

    return withOwner(this.apiPool, ownerId, async (client, owner) => {
      const vault = await vaultForOwner(client, publicId, true);
      const nextKeyVersion = Number(value?.nextKeyVersion);
      if (!Number.isSafeInteger(nextKeyVersion) || nextKeyVersion !== vault.active_key_version + 1) {
        throw new DeviceCloudError('invalid next key version');
      }
      const devices = await client.query(`
        SELECT id FROM nexora_cloud.devices
        WHERE vault_id = $1 AND revoked_at IS NULL
        ORDER BY id
        FOR UPDATE
      `, [vault.id]);
      if (!devices.rows.some((row) => row.id === targetId)) {
        throw new DeviceCloudError('active device not found', 404, 'not_found');
      }
      const remainingIds = devices.rows.map((row) => row.id).filter((id) => id !== targetId);
      if (!remainingIds.length) throw new DeviceCloudError('cannot revoke the final active device', 409, 'final_device');
      const envelopeMap = new Map();
      for (const entry of envelopes) {
        const id = requiredUuid(entry?.deviceId, 'envelope device id');
        if (envelopeMap.has(id)) throw new DeviceCloudError('duplicate device envelope');
        envelopeMap.set(id, wrappedKey(entry?.wrappedVaultKey));
      }
      if (
        envelopeMap.size !== remainingIds.length
        || remainingIds.some((id) => !envelopeMap.has(id))
      ) throw new DeviceCloudError('all remaining devices require a new key envelope');

      await client.query(`
        UPDATE nexora_cloud.device_key_envelopes
        SET superseded_at = now()
        WHERE vault_id = $1 AND superseded_at IS NULL
      `, [vault.id]);
      await client.query(`
        UPDATE nexora_cloud.recovery_key_envelopes
        SET superseded_at = now()
        WHERE vault_id = $1 AND superseded_at IS NULL
      `, [vault.id]);
      for (const deviceId of remainingIds) {
        await client.query(`
          INSERT INTO nexora_cloud.device_key_envelopes (
            owner_id, vault_id, device_id, key_version, wrapping_algorithm, wrapped_vault_key
          ) VALUES ($1, $2, $3, $4, 'ECDH-ES+A256KW', $5)
        `, [owner, vault.id, deviceId, nextKeyVersion, envelopeMap.get(deviceId)]);
      }
      await client.query(`
        INSERT INTO nexora_cloud.recovery_key_envelopes (
          owner_id, vault_id, key_version, recovery_key_id, wrapping_algorithm, wrapped_vault_key
        ) VALUES ($1, $2, $3, $4, 'HKDF-SHA256+A256KW', $5)
      `, [owner, vault.id, nextKeyVersion, recovery.recoveryKeyId, recovery.wrappedVaultKey]);
      await client.query('UPDATE nexora_cloud.devices SET revoked_at = now() WHERE id = $1', [targetId]);
      await client.query(`
        UPDATE nexora_cloud.companion_vaults
        SET active_key_version = $1, updated_at = now()
        WHERE id = $2
      `, [nextKeyVersion, vault.id]);
      return { revokedDeviceId: targetId, keyVersion: nextKeyVersion, activeDeviceIds: remainingIds };
    });
  }

  async recoverVaultEnvelope(ownerId, value) {
    const publicId = requiredVaultId(value?.vaultId);
    let keyId;
    try {
      keyId = Buffer.from(fromBase64Url(value?.recoveryKeyId, 32, 32));
    } catch (error) {
      throw new DeviceCloudError('invalid recovery key id');
    }
    return withOwner(this.apiPool, ownerId, async (client) => {
      const result = await client.query(`
        SELECT v.active_key_version, r.wrapping_algorithm, r.wrapped_vault_key
        FROM nexora_cloud.companion_vaults v
        JOIN nexora_cloud.recovery_key_envelopes r
          ON r.vault_id = v.id AND r.key_version = v.active_key_version
        WHERE v.public_id = $1 AND r.recovery_key_id = $2 AND r.superseded_at IS NULL
      `, [publicId, keyId]);
      if (!result.rowCount) throw new DeviceCloudError('recovery envelope not found', 404, 'not_found');
      return {
        vaultId: publicId,
        keyVersion: result.rows[0].active_key_version,
        algorithm: result.rows[0].wrapping_algorithm,
        wrappedVaultKey: toBase64Url(result.rows[0].wrapped_vault_key)
      };
    });
  }

  async scheduleDeletion(ownerId, value) {
    const scope = value?.scope === 'account' ? 'account' : 'vault';
    const publicId = scope === 'vault' ? requiredVaultId(value?.vaultId) : null;
    return withOwner(this.apiPool, ownerId, async (client, owner) => {
      let vaultUuid = null;
      if (publicId) vaultUuid = (await vaultForOwner(client, publicId)).id;
      const executeAfter = value?.immediate
        ? new Date(Date.now() + 1000)
        : new Date(Date.now() + 7 * 86400000);
      const result = await client.query(`
        INSERT INTO nexora_cloud.deletion_requests (owner_id, scope, vault_id, execute_after)
        VALUES ($1, $2, $3, $4)
        RETURNING id, scope, status, execute_after
      `, [owner, scope, vaultUuid, executeAfter]);
      return {
        requestId: result.rows[0].id,
        scope: result.rows[0].scope,
        status: result.rows[0].status,
        executeAfter: result.rows[0].execute_after.toISOString()
      };
    });
  }

  async executeDeletion(ownerId, requestId) {
    const id = requiredUuid(requestId, 'deletion request id');
    return withOwner(this.maintenancePool, ownerId, async (client, owner) => {
      await client.query("SELECT set_config('app.allow_event_maintenance', 'on', true)");
      const request = await client.query(`
        SELECT id, scope, vault_id, status
        FROM nexora_cloud.deletion_requests
        WHERE id = $1
        FOR UPDATE
      `, [id]);
      if (!request.rowCount) throw new DeviceCloudError('deletion request not found', 404, 'not_found');
      if (!['scheduled', 'failed'].includes(request.rows[0].status)) {
        throw new DeviceCloudError('deletion request cannot be executed', 409, 'invalid_state');
      }
      const vaultFilter = request.rows[0].scope === 'vault' ? request.rows[0].vault_id : null;
      await client.query("UPDATE nexora_cloud.deletion_requests SET status = 'running' WHERE id = $1", [id]);
      const snapshots = await client.query(`
        SELECT object_key FROM nexora_cloud.companion_snapshots
        WHERE owner_id = $1 AND ($2::uuid IS NULL OR vault_id = $2)
      `, [owner, vaultFilter]);
      const tables = [
        'device_commands',
        'telemetry_rollups',
        'companion_snapshots',
        'device_key_envelopes',
        'recovery_key_envelopes',
        'companion_events'
      ];
      for (const table of tables) {
        await client.query(`
          DELETE FROM nexora_cloud.${table}
          WHERE owner_id = $1 AND ($2::uuid IS NULL OR vault_id = $2)
        `, [owner, vaultFilter]);
      }
      await client.query(`
        DELETE FROM nexora_cloud.devices
        WHERE owner_id = $1 AND ($2::uuid IS NULL OR vault_id = $2)
      `, [owner, vaultFilter]);
      await client.query(`
        DELETE FROM nexora_cloud.companion_vaults
        WHERE owner_id = $1 AND ($2::uuid IS NULL OR id = $2)
      `, [owner, vaultFilter]);
      if (request.rows[0].scope === 'account') {
        await client.query('DELETE FROM nexora_cloud.accounts WHERE id = $1', [owner]);
      }
      await client.query(`
        UPDATE nexora_cloud.deletion_requests
        SET status = 'complete', completed_at = now()
        WHERE id = $1
      `, [id]);
      return {
        requestId: id,
        status: 'complete',
        objectKeysToDelete: snapshots.rows.map((row) => row.object_key)
      };
    });
  }

  async close() {
    await Promise.all([this.apiPool.end(), this.maintenancePool.end()]);
  }
}
