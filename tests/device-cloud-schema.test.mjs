import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migrationUrl = new URL(
  '../netlify/database/migrations/202607300001_device_cloud_foundation.sql',
  import.meta.url
);
const sql = await readFile(migrationUrl, 'utf8');
const maintenanceMigration = await readFile(
  new URL('../netlify/database/migrations/202607300002_event_maintenance_policy.sql', import.meta.url),
  'utf8'
);
const netlifyRuntimeGuard = await readFile(
  new URL('../netlify/database/migrations/202607300003_device_cloud_runtime_roles.sql', import.meta.url),
  'utf8'
);

const userTables = [
  'accounts',
  'companion_vaults',
  'devices',
  'device_key_envelopes',
  'recovery_key_envelopes',
  'companion_events',
  'companion_snapshots',
  'device_commands',
  'telemetry_rollups',
  'deletion_requests'
];

test('device cloud migration defines the complete encrypted product data boundary', () => {
  for (const table of userTables) {
    assert.match(sql, new RegExp(`CREATE TABLE nexora_cloud\\.${table} \\(`));
  }
  assert.match(sql, /ciphertext bytea NOT NULL/);
  assert.match(sql, /wrapped_vault_key bytea NOT NULL/);
  assert.match(sql, /external_subject_hash bytea NOT NULL/);
  assert.doesNotMatch(sql, /\b(email|password|transcript|companion_name|audio_blob)\b/i);
});

test('every user table forces row-level security and public access is revoked', () => {
  for (const table of userTables) {
    assert.match(sql, new RegExp(`ALTER TABLE nexora_cloud\\.${table} FORCE ROW LEVEL SECURITY;`));
  }
  assert.match(sql, /REVOKE ALL ON SCHEMA nexora_cloud FROM PUBLIC;/);
  assert.match(sql, /REVOKE ALL ON ALL TABLES IN SCHEMA nexora_cloud FROM PUBLIC;/);
});

test('companion events are append-only, idempotent, encrypted, and device signed', () => {
  assert.match(sql, /UNIQUE \(device_id, device_sequence\)/);
  assert.match(sql, /event_id uuid NOT NULL UNIQUE/);
  assert.match(sql, /encryption_algorithm = 'A256GCM'/);
  assert.match(sql, /signature_algorithm = 'ES256'/);
  assert.match(sql, /FOREIGN KEY \(device_id, signing_key_id\)/);
  assert.match(sql, /device_sequence = 1 AND previous_event_hash IS NULL/);
  assert.match(sql, /CREATE TRIGGER companion_events_append_only/);
  assert.match(sql, /CREATE POLICY companion_events_insert_policy/);
  assert.doesNotMatch(sql, /CREATE POLICY companion_events_(update|delete)_policy/);
  assert.match(maintenanceMigration, /FOR DELETE/);
  assert.match(maintenanceMigration, /current_owner_id\(\)/);
});

test('device registration stores public keys only and separates recovery envelopes', () => {
  assert.match(sql, /NOT \(signing_public_key_jwk \? 'd'\)/);
  assert.match(sql, /NOT \(exchange_public_key_jwk \? 'd'\)/);
  assert.match(sql, /wrapping_algorithm = 'ECDH-ES\+A256KW'/);
  assert.match(sql, /wrapping_algorithm = 'HKDF-SHA256\+A256KW'/);
});

test('Netlify runtime validates forced RLS without altering platform-owned roles', () => {
  assert.match(netlifyRuntimeGuard, /NOT c\.relrowsecurity OR NOT c\.relforcerowsecurity/);
  assert.match(netlifyRuntimeGuard, /REVOKE ALL ON SCHEMA nexora_cloud FROM PUBLIC/);
  assert.doesNotMatch(netlifyRuntimeGuard, /CREATE ROLE|ALTER ROLE|SET LOCAL ROLE|rolbypassrls/);
});
