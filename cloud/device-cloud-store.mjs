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
  normalizeDeviceCommandAgent,
  normalizeDeviceCommandSubmission,
  normalizeEncryptedSnapshot,
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

const runtimeRoles = new Set(['nexora_cloud_api', 'nexora_cloud_maintenance']);

async function withOwner(pool, ownerId, operation, runtimeRole = '') {
  const owner = requiredUuid(ownerId, 'owner id');
  if (runtimeRole && !runtimeRoles.has(runtimeRole)) throw new Error('invalid database runtime role');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (runtimeRole) await client.query(`SET LOCAL ROLE ${runtimeRole}`);
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

async function withMaintenance(pool, operation, runtimeRole = '') {
  if (runtimeRole && !runtimeRoles.has(runtimeRole)) throw new Error('invalid database runtime role');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (runtimeRole) await client.query(`SET LOCAL ROLE ${runtimeRole}`);
    const result = await operation(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function withRuntimeRole(pool, operation, runtimeRole = '') {
  if (runtimeRole && !runtimeRoles.has(runtimeRole)) throw new Error('invalid database runtime role');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (runtimeRole) await client.query(`SET LOCAL ROLE ${runtimeRole}`);
    const result = await operation(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function vaultForOwner(client, ownerId, publicId, lock = false) {
  const result = await client.query(`
    SELECT id, public_id, active_key_version, latest_event_cursor, status
    FROM nexora_cloud.companion_vaults
    WHERE public_id = $1 AND owner_id = $2
    ${lock ? 'FOR UPDATE' : ''}
  `, [requiredVaultId(publicId), requiredUuid(ownerId, 'owner id')]);
  if (!result.rowCount) throw new DeviceCloudError('vault not found', 404, 'not_found');
  return result.rows[0];
}

function requiredSnapshotObjects(value) {
  if (!value || typeof value.put !== 'function' || typeof value.get !== 'function') {
    throw new DeviceCloudError('snapshot object storage unavailable', 503, 'snapshot_storage_unavailable');
  }
  return value;
}

function requiredObjectNamespace(value) {
  const namespace = String(value || 'staging').toLowerCase();
  if (!/^[a-z0-9-]{2,32}$/.test(namespace)) {
    throw new DeviceCloudError('invalid snapshot namespace', 500, 'snapshot_storage_unavailable');
  }
  return namespace;
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
    this.apiRole = String(options.apiRole || '');
    this.maintenanceRole = String(options.maintenanceRole || '');
    if (this.apiRole && !runtimeRoles.has(this.apiRole)) throw new Error('invalid API database role');
    if (this.maintenanceRole && !runtimeRoles.has(this.maintenanceRole)) {
      throw new Error('invalid maintenance database role');
    }
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
    }, this.apiRole);
  }

  async registerDevice(ownerId, value) {
    return withOwner(this.apiPool, ownerId, async (client, owner) => {
      const vault = await vaultForOwner(client, owner, value?.vaultId, true);
      if (vault.status !== 'active') throw new DeviceCloudError('vault is not active', 409, 'vault_locked');
      const device = await insertDevice(client, owner, vault, value?.device, vault.active_key_version);
      return { deviceId: device.id, vaultId: vault.public_id, keyVersion: vault.active_key_version };
    }, this.apiRole);
  }

  async registerCommandAgent(ownerId, value) {
    const agent = normalizeDeviceCommandAgent(value);
    return withOwner(this.apiPool, ownerId, async (client, owner) => {
      const vault = await vaultForOwner(client, owner, agent.vaultId);
      if (vault.status !== 'active') throw new DeviceCloudError('vault is not active', 409, 'vault_locked');
      const inserted = await client.query(`
        INSERT INTO nexora_cloud.device_command_agents (
          id, owner_id, vault_id, display_name, credential_hash
        ) VALUES ($1, $2, $3, $4, $5)
        RETURNING id, display_name, status, created_at
      `, [agent.id, owner, vault.id, agent.displayName, agent.credentialHash]);
      return {
        agentId: inserted.rows[0].id,
        vaultId: vault.public_id,
        displayName: inserted.rows[0].display_name,
        status: inserted.rows[0].status,
        createdAt: inserted.rows[0].created_at.toISOString()
      };
    }, this.apiRole);
  }

  async commandAgentStatus(ownerId, value) {
    const agentId = requiredUuid(value?.agentId, 'command agent id');
    const publicId = requiredVaultId(value?.vaultId);
    return withOwner(this.apiPool, ownerId, async (client, owner) => {
      const vault = await vaultForOwner(client, owner, publicId);
      const result = await client.query(`
        SELECT id, display_name, status, created_at, last_seen_at
        FROM nexora_cloud.device_command_agents
        WHERE id = $1 AND vault_id = $2 AND owner_id = $3
      `, [agentId, vault.id, owner]);
      if (!result.rowCount) throw new DeviceCloudError('command agent not found', 404, 'not_found');
      const row = result.rows[0];
      return {
        agentId: row.id,
        vaultId: publicId,
        displayName: row.display_name,
        status: row.status,
        createdAt: row.created_at.toISOString(),
        lastSeenAt: row.last_seen_at?.toISOString() || null
      };
    }, this.apiRole);
  }

  async queueCommand(ownerId, value) {
    const command = normalizeDeviceCommandSubmission(value);
    return withOwner(this.apiPool, ownerId, async (client, owner) => {
      const vault = await vaultForOwner(client, owner, command.vaultId);
      if (vault.status !== 'active') throw new DeviceCloudError('vault is not active', 409, 'vault_locked');
      const agent = await client.query(`
        SELECT 1 FROM nexora_cloud.device_command_agents
        WHERE id = $1 AND vault_id = $2 AND owner_id = $3
          AND status = 'active' AND revoked_at IS NULL
      `, [command.agentId, vault.id, owner]);
      if (!agent.rowCount) throw new DeviceCloudError('command agent not found', 404, 'not_found');
      const expiresAt = new Date(Date.now() + command.expiresInSeconds * 1000);
      const inserted = await client.query(`
        INSERT INTO nexora_cloud.device_commands (
          owner_id, vault_id, target_device_id, target_agent_id, key_version,
          encryption_algorithm, iv, ciphertext, expires_at
        ) VALUES ($1, $2, NULL, $3, $4, 'A256GCM', $5, $6, $7)
        RETURNING id, status, created_at, expires_at
      `, [owner, vault.id, command.agentId, command.keyVersion, command.iv, command.ciphertext, expiresAt]);
      const row = inserted.rows[0];
      return {
        commandId: row.id,
        agentId: command.agentId,
        status: row.status,
        createdAt: row.created_at.toISOString(),
        expiresAt: row.expires_at.toISOString()
      };
    }, this.apiRole);
  }

  async commandStatus(ownerId, commandIdValue) {
    const commandId = requiredUuid(commandIdValue, 'command id');
    return withOwner(this.apiPool, ownerId, async (client, owner) => {
      const result = await client.query(`
        SELECT id, target_agent_id, status, created_at, expires_at, delivered_at, acknowledged_at
        FROM nexora_cloud.device_commands
        WHERE id = $1 AND owner_id = $2 AND target_agent_id IS NOT NULL
      `, [commandId, owner]);
      if (!result.rowCount) throw new DeviceCloudError('command not found', 404, 'not_found');
      const row = result.rows[0];
      return {
        commandId: row.id,
        agentId: row.target_agent_id,
        status: row.status,
        createdAt: row.created_at.toISOString(),
        expiresAt: row.expires_at.toISOString(),
        deliveredAt: row.delivered_at?.toISOString() || null,
        acknowledgedAt: row.acknowledged_at?.toISOString() || null
      };
    }, this.apiRole);
  }

  async authenticateCommandAgent(agentIdValue, secretValue) {
    const agentId = requiredUuid(agentIdValue, 'command agent id');
    let secret;
    try {
      secret = Buffer.from(fromBase64Url(secretValue, 32, 32));
    } catch (error) {
      throw new DeviceCloudError('invalid command agent credential', 401, 'unauthorized');
    }
    const credentialHash = createHash('sha256').update(secret).digest();
    const result = await withRuntimeRole(this.apiPool, (client) => client.query(`
        SELECT agent_id, owner_id, vault_id, public_vault_id
        FROM nexora_cloud.authenticate_device_command_agent($1, $2)
      `, [agentId, credentialHash]), this.apiRole);
    if (!result.rowCount) throw new DeviceCloudError('unauthorized', 401, 'unauthorized');
    return {
      agentId: result.rows[0].agent_id,
      ownerId: result.rows[0].owner_id,
      vaultUuid: result.rows[0].vault_id,
      vaultId: result.rows[0].public_vault_id
    };
  }

  async claimCommand(agentAuth) {
    return withOwner(this.apiPool, agentAuth.ownerId, async (client, owner) => {
      await client.query(`
        UPDATE nexora_cloud.device_commands
        SET status = 'expired'
        WHERE owner_id = $1 AND target_agent_id = $2
          AND status IN ('queued', 'delivered') AND expires_at <= now()
      `, [owner, agentAuth.agentId]);
      const result = await client.query(`
        WITH next_command AS (
          SELECT id
          FROM nexora_cloud.device_commands
          WHERE owner_id = $1 AND vault_id = $2 AND target_agent_id = $3
            AND status = 'queued' AND expires_at > now()
          ORDER BY created_at ASC, id ASC
          FOR UPDATE SKIP LOCKED
          LIMIT 1
        )
        UPDATE nexora_cloud.device_commands AS command
        SET status = 'delivered', delivered_at = now()
        FROM next_command
        WHERE command.id = next_command.id AND command.owner_id = $1
        RETURNING command.id, command.key_version, command.iv, command.ciphertext,
          command.created_at, command.expires_at, command.delivered_at
      `, [owner, agentAuth.vaultUuid, agentAuth.agentId]);
      if (!result.rowCount) return { command: null };
      const row = result.rows[0];
      return {
        command: {
          commandId: row.id,
          version: 1,
          agentId: agentAuth.agentId,
          vaultId: agentAuth.vaultId,
          keyVersion: row.key_version,
          expiresInSeconds: Math.max(30, Math.min(300, Math.ceil((row.expires_at.getTime() - row.created_at.getTime()) / 1000))),
          createdAt: row.created_at.toISOString(),
          expiresAt: row.expires_at.toISOString(),
          deliveredAt: row.delivered_at.toISOString(),
          payload: {
            algorithm: 'A256GCM',
            iv: toBase64Url(row.iv),
            ciphertext: toBase64Url(row.ciphertext)
          }
        }
      };
    }, this.apiRole);
  }

  async acknowledgeCommand(agentAuth, commandIdValue, outcomeValue) {
    const commandId = requiredUuid(commandIdValue, 'command id');
    const outcome = outcomeValue === 'failed' ? 'failed' : 'acknowledged';
    return withOwner(this.apiPool, agentAuth.ownerId, async (client, owner) => {
      const result = await client.query(`
        UPDATE nexora_cloud.device_commands
        SET status = $1, acknowledged_at = now()
        WHERE id = $2 AND owner_id = $3 AND vault_id = $4 AND target_agent_id = $5
          AND status = 'delivered' AND expires_at > now()
        RETURNING id, status, acknowledged_at
      `, [outcome, commandId, owner, agentAuth.vaultUuid, agentAuth.agentId]);
      if (!result.rowCount) throw new DeviceCloudError('command is no longer claimable', 409, 'command_state');
      await client.query(`
        UPDATE nexora_cloud.device_command_agents
        SET last_seen_at = now()
        WHERE id = $1 AND owner_id = $2 AND vault_id = $3
          AND status = 'active' AND revoked_at IS NULL
      `, [agentAuth.agentId, owner, agentAuth.vaultUuid]);
      return {
        commandId: result.rows[0].id,
        status: result.rows[0].status,
        acknowledgedAt: result.rows[0].acknowledged_at.toISOString()
      };
    }, this.apiRole);
  }

  async appendEvent(ownerId, value) {
    const event = normalizeDeviceCloudEvent(value);
    if (!event) throw new DeviceCloudError('invalid encrypted event');
    const canonical = canonicalDeviceCloudEvent(event);
    const contentHash = createHash('sha256').update(canonical).digest();

    return withOwner(this.apiPool, ownerId, async (client, owner) => {
      const deviceResult = await client.query(`
        SELECT
          d.id, d.signing_key_id, d.signing_public_key_jwk, d.revoked_at,
          v.id AS vault_uuid, v.public_id, v.active_key_version, v.status
        FROM nexora_cloud.devices d
        JOIN nexora_cloud.companion_vaults v ON v.id = d.vault_id
        WHERE d.id = $1 AND d.owner_id = $3
          AND v.public_id = $2 AND v.owner_id = $3
        FOR UPDATE OF d, v
      `, [event.deviceId, event.vaultId, owner]);
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
        WHERE owner_id = $4
          AND (event_id = $1 OR (device_id = $2 AND device_sequence = $3))
        LIMIT 1
      `, [event.eventId, event.deviceId, event.deviceSequence, owner]);
      if (duplicate.rowCount) {
        if (!duplicate.rows[0].content_hash.equals(contentHash)) {
          throw new DeviceCloudError('event identity conflict', 409, 'event_conflict');
        }
        return {
          cursor: Number(duplicate.rows[0].cursor),
          duplicate: true,
          contentHash: toBase64Url(duplicate.rows[0].content_hash)
        };
      }

      if (event.keyVersion !== device.active_key_version) {
        throw new DeviceCloudError('stale vault key version', 409, 'stale_key');
      }
      const previous = await client.query(`
        SELECT device_sequence, content_hash
        FROM nexora_cloud.companion_events
        WHERE device_id = $1 AND owner_id = $2
        ORDER BY device_sequence DESC
        LIMIT 1
      `, [event.deviceId, owner]);
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
        WHERE id = $2 AND owner_id = $3
      `, [cursor, device.vault_uuid, owner]);
      return { cursor, duplicate: false, contentHash: toBase64Url(contentHash) };
    }, this.apiRole);
  }

  async listEvents(ownerId, { vaultId, requesterDeviceId, after = 0, limit = 200 }) {
    const publicId = requiredVaultId(vaultId);
    const deviceId = requiredUuid(requesterDeviceId, 'requester device id');
    const cursor = Number.isSafeInteger(Number(after)) && Number(after) >= 0 ? Number(after) : 0;
    const pageSize = Math.min(200, Math.max(1, Math.floor(Number(limit) || 200)));
    return withOwner(this.apiPool, ownerId, async (client, owner) => {
      const vault = await vaultForOwner(client, owner, publicId);
      const requester = await client.query(`
        SELECT 1 FROM nexora_cloud.devices
        WHERE id = $1 AND vault_id = $2 AND owner_id = $3 AND revoked_at IS NULL
      `, [deviceId, vault.id, owner]);
      if (!requester.rowCount) throw new DeviceCloudError('device revoked or unknown', 403, 'device_revoked');
      const result = await client.query(`
        SELECT
          cursor, event_id, device_id, device_sequence, occurred_at, key_version,
          iv, ciphertext, previous_event_hash, content_hash, signing_key_id, signature
        FROM nexora_cloud.companion_events
        WHERE vault_id = $1 AND owner_id = $4 AND cursor > $2
        ORDER BY cursor ASC
        LIMIT $3
      `, [vault.id, cursor, pageSize, owner]);
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
    }, this.apiRole);
  }

  async createSnapshot(ownerId, value, options = {}) {
    const snapshot = normalizeEncryptedSnapshot(value);
    const objects = requiredSnapshotObjects(options.objects);
    if (typeof objects.delete !== 'function') {
      throw new DeviceCloudError('snapshot object storage unavailable', 503, 'snapshot_storage_unavailable');
    }
    const namespace = requiredObjectNamespace(options.namespace);
    const objectKey = `${namespace}/snapshots/${randomUUID()}.bin`;
    const contentHash = createHash('sha256').update(snapshot.ciphertext).digest();
    let objectStored = false;

    try {
      return await withOwner(this.apiPool, ownerId, async (client, owner) => {
        const vault = await vaultForOwner(client, owner, snapshot.vaultId, true);
        if (vault.status !== 'active') throw new DeviceCloudError('vault is not active', 409, 'vault_locked');
        if (snapshot.keyVersion !== vault.active_key_version) {
          throw new DeviceCloudError('stale vault key version', 409, 'stale_key');
        }
        if (snapshot.throughCursor > Number(vault.latest_event_cursor)) {
          throw new DeviceCloudError('snapshot cursor is ahead of the event log', 409, 'cursor_ahead');
        }
        const requester = await client.query(`
          SELECT 1 FROM nexora_cloud.devices
          WHERE id = $1 AND vault_id = $2 AND owner_id = $3 AND revoked_at IS NULL
        `, [snapshot.deviceId, vault.id, owner]);
        if (!requester.rowCount) throw new DeviceCloudError('device revoked or unknown', 403, 'device_revoked');

        const existing = await client.query(`
          SELECT id, key_version, iv, ciphertext_size, content_hash, created_at
          FROM nexora_cloud.companion_snapshots
          WHERE vault_id = $1 AND owner_id = $2 AND through_cursor = $3
          LIMIT 1
        `, [vault.id, owner, snapshot.throughCursor]);
        if (existing.rowCount) {
          const row = existing.rows[0];
          if (
            row.key_version !== snapshot.keyVersion
            || !row.iv.equals(snapshot.iv)
            || Number(row.ciphertext_size) !== snapshot.ciphertext.byteLength
            || !row.content_hash.equals(contentHash)
          ) throw new DeviceCloudError('snapshot cursor conflict', 409, 'snapshot_conflict');
          return {
            snapshotId: row.id,
            vaultId: snapshot.vaultId,
            throughCursor: snapshot.throughCursor,
            keyVersion: row.key_version,
            createdAt: row.created_at.toISOString(),
            duplicate: true
          };
        }

        try {
          await objects.put(objectKey, snapshot.ciphertext);
          objectStored = true;
        } catch (error) {
          throw new DeviceCloudError('snapshot object storage unavailable', 503, 'snapshot_storage_unavailable');
        }
        const inserted = await client.query(`
          INSERT INTO nexora_cloud.companion_snapshots (
            owner_id, vault_id, created_by_device_id, through_cursor, key_version,
            encryption_algorithm, iv, object_key, ciphertext_size, content_hash
          ) VALUES ($1, $2, $3, $4, $5, 'A256GCM', $6, $7, $8, $9)
          RETURNING id, created_at
        `, [
          owner,
          vault.id,
          snapshot.deviceId,
          snapshot.throughCursor,
          snapshot.keyVersion,
          snapshot.iv,
          objectKey,
          snapshot.ciphertext.byteLength,
          contentHash
        ]);
        const stale = await client.query(`
          WITH ranked AS (
            SELECT
              id,
              object_key,
              row_number() OVER (ORDER BY through_cursor DESC) AS recent_rank,
              row_number() OVER (
                PARTITION BY date_trunc('month', created_at)
                ORDER BY through_cursor DESC
              ) AS monthly_rank
            FROM nexora_cloud.companion_snapshots
            WHERE vault_id = $1 AND owner_id = $2
          )
          SELECT id, object_key
          FROM ranked
          WHERE recent_rank > 3 AND monthly_rank > 1
          ORDER BY id
        `, [vault.id, owner]);
        let prunedSnapshots = 0;
        for (const row of stale.rows) {
          try {
            await objects.delete(row.object_key);
          } catch (error) {
            continue;
          }
          await client.query(`
            DELETE FROM nexora_cloud.companion_snapshots
            WHERE id = $1 AND owner_id = $2 AND vault_id = $3
          `, [row.id, owner, vault.id]);
          prunedSnapshots += 1;
        }
        return {
          snapshotId: inserted.rows[0].id,
          vaultId: snapshot.vaultId,
          throughCursor: snapshot.throughCursor,
          keyVersion: snapshot.keyVersion,
          createdAt: inserted.rows[0].created_at.toISOString(),
          duplicate: false,
          prunedSnapshots
        };
      }, this.apiRole);
    } catch (error) {
      if (objectStored && typeof objects.delete === 'function') {
        await objects.delete(objectKey).catch(() => {});
      }
      throw error;
    }
  }

  async latestSnapshot(ownerId, value, options = {}) {
    const publicId = requiredVaultId(value?.vaultId);
    const deviceId = requiredUuid(value?.requesterDeviceId, 'requester device id');
    const objects = requiredSnapshotObjects(options.objects);

    return withOwner(this.apiPool, ownerId, async (client, owner) => {
      const vault = await vaultForOwner(client, owner, publicId);
      const requester = await client.query(`
        SELECT 1 FROM nexora_cloud.devices
        WHERE id = $1 AND vault_id = $2 AND owner_id = $3 AND revoked_at IS NULL
      `, [deviceId, vault.id, owner]);
      if (!requester.rowCount) throw new DeviceCloudError('device revoked or unknown', 403, 'device_revoked');
      const result = await client.query(`
        SELECT id, through_cursor, key_version, iv, object_key, ciphertext_size, content_hash, created_at
        FROM nexora_cloud.companion_snapshots
        WHERE vault_id = $1 AND owner_id = $2
        ORDER BY through_cursor DESC
        LIMIT 1
      `, [vault.id, owner]);
      if (!result.rowCount) throw new DeviceCloudError('snapshot not found', 404, 'not_found');
      const row = result.rows[0];
      let ciphertext;
      try {
        ciphertext = await objects.get(row.object_key);
      } catch (error) {
        throw new DeviceCloudError('snapshot object storage unavailable', 503, 'snapshot_storage_unavailable');
      }
      const bytes = ciphertext == null ? null : Buffer.from(ciphertext);
      if (
        !bytes
        || bytes.byteLength !== Number(row.ciphertext_size)
        || !createHash('sha256').update(bytes).digest().equals(row.content_hash)
      ) throw new DeviceCloudError('snapshot integrity check failed', 503, 'snapshot_integrity_failed');
      return {
        snapshotId: row.id,
        vaultId: publicId,
        throughCursor: Number(row.through_cursor),
        keyVersion: row.key_version,
        createdAt: row.created_at.toISOString(),
        contentHash: toBase64Url(row.content_hash),
        payload: {
          algorithm: 'A256GCM',
          iv: toBase64Url(row.iv),
          ciphertext: toBase64Url(bytes)
        }
      };
    }, this.apiRole);
  }

  async revokeDevice(ownerId, targetDeviceId, value) {
    const targetId = requiredUuid(targetDeviceId, 'device id');
    const publicId = requiredVaultId(value?.vaultId);
    const envelopes = Array.isArray(value?.envelopes) ? value.envelopes : [];
    const recovery = normalizeRecoveryEnvelope(value?.recovery);

    return withOwner(this.apiPool, ownerId, async (client, owner) => {
      const vault = await vaultForOwner(client, owner, publicId, true);
      const nextKeyVersion = Number(value?.nextKeyVersion);
      if (!Number.isSafeInteger(nextKeyVersion) || nextKeyVersion !== vault.active_key_version + 1) {
        throw new DeviceCloudError('invalid next key version');
      }
      const devices = await client.query(`
        SELECT id FROM nexora_cloud.devices
        WHERE vault_id = $1 AND owner_id = $2 AND revoked_at IS NULL
        ORDER BY id
        FOR UPDATE
      `, [vault.id, owner]);
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
        WHERE vault_id = $1 AND owner_id = $2 AND superseded_at IS NULL
      `, [vault.id, owner]);
      await client.query(`
        UPDATE nexora_cloud.recovery_key_envelopes
        SET superseded_at = now()
        WHERE vault_id = $1 AND owner_id = $2 AND superseded_at IS NULL
      `, [vault.id, owner]);
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
      await client.query(
        'UPDATE nexora_cloud.devices SET revoked_at = now() WHERE id = $1 AND owner_id = $2',
        [targetId, owner]
      );
      await client.query(`
        UPDATE nexora_cloud.companion_vaults
        SET active_key_version = $1, updated_at = now()
        WHERE id = $2 AND owner_id = $3
      `, [nextKeyVersion, vault.id, owner]);
      return { revokedDeviceId: targetId, keyVersion: nextKeyVersion, activeDeviceIds: remainingIds };
    }, this.apiRole);
  }

  async recoverVaultEnvelope(ownerId, value) {
    const publicId = requiredVaultId(value?.vaultId);
    let keyId;
    try {
      keyId = Buffer.from(fromBase64Url(value?.recoveryKeyId, 32, 32));
    } catch (error) {
      throw new DeviceCloudError('invalid recovery key id');
    }
    return withOwner(this.apiPool, ownerId, async (client, owner) => {
      const result = await client.query(`
        SELECT v.active_key_version, r.wrapping_algorithm, r.wrapped_vault_key
        FROM nexora_cloud.companion_vaults v
        JOIN nexora_cloud.recovery_key_envelopes r
          ON r.vault_id = v.id AND r.key_version = v.active_key_version
        WHERE v.public_id = $1 AND v.owner_id = $3
          AND r.owner_id = $3 AND r.recovery_key_id = $2 AND r.superseded_at IS NULL
      `, [publicId, keyId, owner]);
      if (!result.rowCount) throw new DeviceCloudError('recovery envelope not found', 404, 'not_found');
      return {
        vaultId: publicId,
        keyVersion: result.rows[0].active_key_version,
        algorithm: result.rows[0].wrapping_algorithm,
        wrappedVaultKey: toBase64Url(result.rows[0].wrapped_vault_key)
      };
    }, this.apiRole);
  }

  async scheduleDeletion(ownerId, value) {
    const scope = value?.scope === 'account' ? 'account' : 'vault';
    const publicId = scope === 'vault' ? requiredVaultId(value?.vaultId) : null;
    return withOwner(this.apiPool, ownerId, async (client, owner) => {
      let vaultUuid = null;
      if (publicId) vaultUuid = (await vaultForOwner(client, owner, publicId)).id;
      const existing = await client.query(`
        SELECT id, scope, status, execute_after
        FROM nexora_cloud.deletion_requests
        WHERE owner_id = $1 AND scope = $2
          AND (($3::uuid IS NULL AND vault_id IS NULL) OR vault_id = $3)
          AND status IN ('scheduled', 'running', 'failed')
        ORDER BY requested_at DESC
        LIMIT 1
      `, [owner, scope, vaultUuid]);
      if (existing.rowCount) {
        return {
          requestId: existing.rows[0].id,
          scope: existing.rows[0].scope,
          status: existing.rows[0].status,
          executeAfter: existing.rows[0].execute_after.toISOString(),
          duplicate: true
        };
      }
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
        executeAfter: result.rows[0].execute_after.toISOString(),
        duplicate: false
      };
    }, this.apiRole);
  }

  async cancelDeletion(ownerId, requestId) {
    const id = requiredUuid(requestId, 'deletion request id');
    return withOwner(this.apiPool, ownerId, async (client, owner) => {
      const cancelled = await client.query(`
        SELECT id, owner_id, scope, status, execute_after
        FROM nexora_cloud.cancel_deletion_request($1, $2)
      `, [owner, id]);
      if (cancelled.rowCount) {
        return {
          requestId: cancelled.rows[0].id,
          scope: cancelled.rows[0].scope,
          status: cancelled.rows[0].status,
          executeAfter: cancelled.rows[0].execute_after.toISOString()
        };
      }
      const existing = await client.query(`
        SELECT status, execute_after
        FROM nexora_cloud.deletion_requests
        WHERE id = $1 AND owner_id = $2
      `, [id, owner]);
      if (!existing.rowCount) throw new DeviceCloudError('deletion request not found', 404, 'not_found');
      throw new DeviceCloudError('deletion request cannot be cancelled', 409, 'invalid_state');
    }, this.apiRole);
  }

  async listDueDeletions(limit = 3) {
    const pageSize = Math.min(10, Math.max(1, Math.floor(Number(limit) || 3)));
    return withMaintenance(this.maintenancePool, async (client) => {
      const result = await client.query(`
        SELECT id, owner_id
        FROM nexora_cloud.list_due_deletion_requests($1)
      `, [pageSize]);
      return result.rows.map((row) => ({ requestId: row.id, ownerId: row.owner_id }));
    }, this.maintenanceRole);
  }

  async executeDeletion(ownerId, requestId, options = {}) {
    const id = requiredUuid(requestId, 'deletion request id');
    try {
      return await withOwner(this.maintenancePool, ownerId, async (client, owner) => {
        await client.query("SELECT set_config('app.allow_event_maintenance', 'on', true)");
        const request = await client.query(`
          SELECT id, scope, vault_id, status, execute_after
          FROM nexora_cloud.deletion_requests
          WHERE id = $1 AND owner_id = $2
          FOR UPDATE
        `, [id, owner]);
        if (!request.rowCount) throw new DeviceCloudError('deletion request not found', 404, 'not_found');
        if (!['scheduled', 'failed'].includes(request.rows[0].status)) {
          throw new DeviceCloudError('deletion request cannot be executed', 409, 'invalid_state');
        }
        if (request.rows[0].execute_after.getTime() > Date.now()) {
          throw new DeviceCloudError('deletion retention window is still active', 409, 'not_due');
        }
        const vaultFilter = request.rows[0].scope === 'vault' ? request.rows[0].vault_id : null;
        const snapshots = await client.query(`
          SELECT object_key FROM nexora_cloud.companion_snapshots
          WHERE owner_id = $1 AND ($2::uuid IS NULL OR vault_id = $2)
        `, [owner, vaultFilter]);
        const objectKeys = snapshots.rows.map((row) => row.object_key);
        if (objectKeys.length) {
          if (typeof options.deleteObjects !== 'function') {
            throw new DeviceCloudError('snapshot deletion unavailable', 503, 'snapshot_delete_failed');
          }
          await client.query(
            "UPDATE nexora_cloud.deletion_requests SET status = 'running' WHERE id = $1 AND owner_id = $2",
            [id, owner]
          );
          try {
            await options.deleteObjects(objectKeys);
          } catch (error) {
            throw new DeviceCloudError('snapshot deletion failed', 503, 'snapshot_delete_failed');
          }
        }
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
          WHERE id = $1 AND owner_id = $2
        `, [id, owner]);
        return {
          requestId: id,
          status: 'complete',
          objectKeysDeleted: objectKeys.length
        };
      }, this.maintenanceRole);
    } catch (error) {
      if (error?.code === 'snapshot_delete_failed') {
        await withOwner(this.maintenancePool, ownerId, (client, owner) => client.query(`
          UPDATE nexora_cloud.deletion_requests
          SET status = 'failed'
          WHERE id = $1 AND owner_id = $2 AND status IN ('scheduled', 'running', 'failed')
        `, [id, owner]), this.maintenanceRole).catch(() => {});
      }
      throw error;
    }
  }

  async close() {
    await Promise.all([...new Set([this.apiPool, this.maintenancePool])].map((pool) => pool.end()));
  }
}
