BEGIN;

CREATE SCHEMA IF NOT EXISTS nexora_cloud;

CREATE OR REPLACE FUNCTION nexora_cloud.current_owner_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('app.owner_id', true), '')::uuid
$$;

CREATE TABLE nexora_cloud.accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  external_subject_hash bytea NOT NULL UNIQUE CHECK (octet_length(external_subject_hash) = 32),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'deleting')),
  region text NOT NULL DEFAULT 'cn' CHECK (region ~ '^[a-z0-9-]{2,16}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE nexora_cloud.companion_vaults (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES nexora_cloud.accounts(id) ON DELETE CASCADE,
  public_id text NOT NULL UNIQUE CHECK (public_id ~ '^[A-Za-z0-9_-]{22}$'),
  protocol_version smallint NOT NULL DEFAULT 1 CHECK (protocol_version = 1),
  active_key_version integer NOT NULL DEFAULT 1 CHECK (active_key_version > 0),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'locked', 'deleting')),
  latest_event_cursor bigint NOT NULL DEFAULT 0 CHECK (latest_event_cursor >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, owner_id)
);

CREATE TABLE nexora_cloud.devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  vault_id uuid NOT NULL,
  device_type text NOT NULL CHECK (device_type IN ('phone', 'pendant', 'desktop', 'recovery')),
  display_name text NOT NULL CHECK (length(display_name) BETWEEN 1 AND 80),
  signing_algorithm text NOT NULL DEFAULT 'ES256' CHECK (signing_algorithm = 'ES256'),
  signing_key_id text NOT NULL CHECK (signing_key_id ~ '^[A-Za-z0-9._:-]{1,64}$'),
  signing_public_key_jwk jsonb NOT NULL CHECK (
    jsonb_typeof(signing_public_key_jwk) = 'object'
    AND signing_public_key_jwk->>'kty' = 'EC'
    AND signing_public_key_jwk->>'crv' = 'P-256'
    AND NOT (signing_public_key_jwk ? 'd')
    AND signing_public_key_jwk->>'x' ~ '^[A-Za-z0-9_-]{43}$'
    AND signing_public_key_jwk->>'y' ~ '^[A-Za-z0-9_-]{43}$'
  ),
  exchange_algorithm text NOT NULL DEFAULT 'ECDH-ES' CHECK (exchange_algorithm = 'ECDH-ES'),
  exchange_public_key_jwk jsonb NOT NULL CHECK (
    jsonb_typeof(exchange_public_key_jwk) = 'object'
    AND exchange_public_key_jwk->>'kty' = 'EC'
    AND exchange_public_key_jwk->>'crv' = 'P-256'
    AND NOT (exchange_public_key_jwk ? 'd')
    AND exchange_public_key_jwk->>'x' ~ '^[A-Za-z0-9_-]{43}$'
    AND exchange_public_key_jwk->>'y' ~ '^[A-Za-z0-9_-]{43}$'
  ),
  firmware_version text CHECK (firmware_version IS NULL OR length(firmware_version) <= 48),
  paired_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz,
  revoked_at timestamptz,
  UNIQUE (signing_key_id),
  UNIQUE (id, signing_key_id),
  UNIQUE (id, owner_id),
  UNIQUE (id, vault_id, owner_id),
  FOREIGN KEY (vault_id, owner_id)
    REFERENCES nexora_cloud.companion_vaults(id, owner_id) ON DELETE CASCADE
);

CREATE TABLE nexora_cloud.device_key_envelopes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  vault_id uuid NOT NULL,
  device_id uuid NOT NULL,
  key_version integer NOT NULL CHECK (key_version > 0),
  wrapping_algorithm text NOT NULL CHECK (wrapping_algorithm = 'ECDH-ES+A256KW'),
  wrapped_vault_key bytea NOT NULL CHECK (octet_length(wrapped_vault_key) BETWEEN 40 AND 2048),
  created_at timestamptz NOT NULL DEFAULT now(),
  superseded_at timestamptz,
  UNIQUE (device_id, key_version),
  FOREIGN KEY (device_id, vault_id, owner_id)
    REFERENCES nexora_cloud.devices(id, vault_id, owner_id) ON DELETE CASCADE
);

CREATE TABLE nexora_cloud.recovery_key_envelopes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  vault_id uuid NOT NULL,
  key_version integer NOT NULL CHECK (key_version > 0),
  recovery_key_id bytea NOT NULL CHECK (octet_length(recovery_key_id) = 32),
  wrapping_algorithm text NOT NULL CHECK (wrapping_algorithm = 'HKDF-SHA256+A256KW'),
  wrapped_vault_key bytea NOT NULL CHECK (octet_length(wrapped_vault_key) BETWEEN 40 AND 2048),
  created_at timestamptz NOT NULL DEFAULT now(),
  superseded_at timestamptz,
  UNIQUE (vault_id, key_version),
  FOREIGN KEY (vault_id, owner_id)
    REFERENCES nexora_cloud.companion_vaults(id, owner_id) ON DELETE CASCADE
);

CREATE TABLE nexora_cloud.companion_events (
  cursor bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_id uuid NOT NULL UNIQUE,
  owner_id uuid NOT NULL,
  vault_id uuid NOT NULL,
  device_id uuid NOT NULL,
  device_sequence bigint NOT NULL CHECK (device_sequence > 0),
  occurred_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  key_version integer NOT NULL CHECK (key_version > 0),
  encryption_algorithm text NOT NULL CHECK (encryption_algorithm = 'A256GCM'),
  iv bytea NOT NULL CHECK (octet_length(iv) = 12),
  ciphertext bytea NOT NULL CHECK (octet_length(ciphertext) BETWEEN 17 AND 262144),
  previous_event_hash bytea CHECK (previous_event_hash IS NULL OR octet_length(previous_event_hash) = 32),
  content_hash bytea NOT NULL CHECK (octet_length(content_hash) = 32),
  signature_algorithm text NOT NULL CHECK (signature_algorithm = 'ES256'),
  signing_key_id text NOT NULL CHECK (signing_key_id ~ '^[A-Za-z0-9._:-]{1,64}$'),
  signature bytea NOT NULL CHECK (octet_length(signature) = 64),
  CHECK (
    (device_sequence = 1 AND previous_event_hash IS NULL)
    OR (device_sequence > 1 AND previous_event_hash IS NOT NULL)
  ),
  UNIQUE (device_id, device_sequence),
  FOREIGN KEY (device_id, signing_key_id)
    REFERENCES nexora_cloud.devices(id, signing_key_id) ON DELETE RESTRICT,
  FOREIGN KEY (device_id, vault_id, owner_id)
    REFERENCES nexora_cloud.devices(id, vault_id, owner_id) ON DELETE RESTRICT
);

CREATE INDEX companion_events_vault_cursor_idx
  ON nexora_cloud.companion_events (vault_id, cursor);
CREATE INDEX companion_events_owner_received_idx
  ON nexora_cloud.companion_events (owner_id, received_at DESC);

CREATE TABLE nexora_cloud.companion_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  vault_id uuid NOT NULL,
  created_by_device_id uuid,
  through_cursor bigint NOT NULL CHECK (through_cursor >= 0),
  key_version integer NOT NULL CHECK (key_version > 0),
  encryption_algorithm text NOT NULL CHECK (encryption_algorithm = 'A256GCM'),
  iv bytea NOT NULL CHECK (octet_length(iv) = 12),
  object_key text NOT NULL CHECK (length(object_key) BETWEEN 16 AND 512),
  ciphertext_size integer NOT NULL CHECK (ciphertext_size BETWEEN 17 AND 1048576),
  content_hash bytea NOT NULL CHECK (octet_length(content_hash) = 32),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (vault_id, through_cursor),
  FOREIGN KEY (vault_id, owner_id)
    REFERENCES nexora_cloud.companion_vaults(id, owner_id) ON DELETE CASCADE,
  FOREIGN KEY (created_by_device_id, vault_id, owner_id)
    REFERENCES nexora_cloud.devices(id, vault_id, owner_id) ON DELETE RESTRICT,
  CHECK (object_key ~ '^[A-Za-z0-9/_=.-]+$' AND object_key !~ '(^|/)\.\.(/|$)')
);

CREATE INDEX companion_snapshots_latest_idx
  ON nexora_cloud.companion_snapshots (vault_id, through_cursor DESC);

CREATE TABLE nexora_cloud.device_commands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  vault_id uuid NOT NULL,
  target_device_id uuid NOT NULL,
  key_version integer NOT NULL CHECK (key_version > 0),
  encryption_algorithm text NOT NULL CHECK (encryption_algorithm = 'A256GCM'),
  iv bytea NOT NULL CHECK (octet_length(iv) = 12),
  ciphertext bytea NOT NULL CHECK (octet_length(ciphertext) BETWEEN 17 AND 16384),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'delivered', 'acknowledged', 'expired', 'failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '5 minutes'),
  acknowledged_at timestamptz,
  CHECK (expires_at > created_at AND expires_at <= created_at + interval '1 day'),
  FOREIGN KEY (target_device_id, vault_id, owner_id)
    REFERENCES nexora_cloud.devices(id, vault_id, owner_id) ON DELETE CASCADE
);

CREATE INDEX device_commands_pending_idx
  ON nexora_cloud.device_commands (target_device_id, status, expires_at);

CREATE TABLE nexora_cloud.telemetry_rollups (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  device_id uuid NOT NULL,
  owner_id uuid NOT NULL,
  vault_id uuid NOT NULL,
  bucket_start timestamptz NOT NULL,
  metric_name text NOT NULL CHECK (metric_name IN ('battery', 'temperature', 'ble-rssi', 'wake-count', 'crash-count')),
  sample_count integer NOT NULL CHECK (sample_count BETWEEN 1 AND 1000000),
  minimum double precision NOT NULL,
  maximum double precision NOT NULL,
  average double precision NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (minimum <= average AND average <= maximum),
  UNIQUE (device_id, bucket_start, metric_name),
  FOREIGN KEY (device_id, vault_id, owner_id)
    REFERENCES nexora_cloud.devices(id, vault_id, owner_id) ON DELETE CASCADE
);

CREATE TABLE nexora_cloud.deletion_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  scope text NOT NULL CHECK (scope IN ('vault', 'account')),
  vault_id uuid,
  status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'running', 'complete', 'failed', 'cancelled')),
  requested_at timestamptz NOT NULL DEFAULT now(),
  execute_after timestamptz NOT NULL,
  completed_at timestamptz,
  CHECK (execute_after > requested_at),
  CHECK ((scope = 'vault' AND vault_id IS NOT NULL) OR (scope = 'account' AND vault_id IS NULL))
);

CREATE INDEX deletion_requests_owner_status_idx
  ON nexora_cloud.deletion_requests (owner_id, status, execute_after);

CREATE OR REPLACE FUNCTION nexora_cloud.reject_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_setting('app.allow_event_maintenance', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'companion events are append-only';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER companion_events_append_only
BEFORE UPDATE OR DELETE ON nexora_cloud.companion_events
FOR EACH ROW EXECUTE FUNCTION nexora_cloud.reject_event_mutation();

ALTER TABLE nexora_cloud.accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE nexora_cloud.accounts FORCE ROW LEVEL SECURITY;
CREATE POLICY accounts_owner_policy ON nexora_cloud.accounts
  USING (id = nexora_cloud.current_owner_id())
  WITH CHECK (id = nexora_cloud.current_owner_id());

ALTER TABLE nexora_cloud.companion_vaults ENABLE ROW LEVEL SECURITY;
ALTER TABLE nexora_cloud.companion_vaults FORCE ROW LEVEL SECURITY;
CREATE POLICY companion_vaults_owner_policy ON nexora_cloud.companion_vaults
  USING (owner_id = nexora_cloud.current_owner_id())
  WITH CHECK (owner_id = nexora_cloud.current_owner_id());

ALTER TABLE nexora_cloud.devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE nexora_cloud.devices FORCE ROW LEVEL SECURITY;
CREATE POLICY devices_owner_policy ON nexora_cloud.devices
  USING (owner_id = nexora_cloud.current_owner_id())
  WITH CHECK (owner_id = nexora_cloud.current_owner_id());

ALTER TABLE nexora_cloud.device_key_envelopes ENABLE ROW LEVEL SECURITY;
ALTER TABLE nexora_cloud.device_key_envelopes FORCE ROW LEVEL SECURITY;
CREATE POLICY device_key_envelopes_owner_policy ON nexora_cloud.device_key_envelopes
  USING (owner_id = nexora_cloud.current_owner_id())
  WITH CHECK (owner_id = nexora_cloud.current_owner_id());

ALTER TABLE nexora_cloud.recovery_key_envelopes ENABLE ROW LEVEL SECURITY;
ALTER TABLE nexora_cloud.recovery_key_envelopes FORCE ROW LEVEL SECURITY;
CREATE POLICY recovery_key_envelopes_owner_policy ON nexora_cloud.recovery_key_envelopes
  USING (owner_id = nexora_cloud.current_owner_id())
  WITH CHECK (owner_id = nexora_cloud.current_owner_id());

ALTER TABLE nexora_cloud.companion_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE nexora_cloud.companion_events FORCE ROW LEVEL SECURITY;
CREATE POLICY companion_events_select_policy ON nexora_cloud.companion_events
  FOR SELECT USING (owner_id = nexora_cloud.current_owner_id());
CREATE POLICY companion_events_insert_policy ON nexora_cloud.companion_events
  FOR INSERT WITH CHECK (owner_id = nexora_cloud.current_owner_id());

ALTER TABLE nexora_cloud.companion_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE nexora_cloud.companion_snapshots FORCE ROW LEVEL SECURITY;
CREATE POLICY companion_snapshots_owner_policy ON nexora_cloud.companion_snapshots
  USING (owner_id = nexora_cloud.current_owner_id())
  WITH CHECK (owner_id = nexora_cloud.current_owner_id());

ALTER TABLE nexora_cloud.device_commands ENABLE ROW LEVEL SECURITY;
ALTER TABLE nexora_cloud.device_commands FORCE ROW LEVEL SECURITY;
CREATE POLICY device_commands_owner_policy ON nexora_cloud.device_commands
  USING (owner_id = nexora_cloud.current_owner_id())
  WITH CHECK (owner_id = nexora_cloud.current_owner_id());

ALTER TABLE nexora_cloud.telemetry_rollups ENABLE ROW LEVEL SECURITY;
ALTER TABLE nexora_cloud.telemetry_rollups FORCE ROW LEVEL SECURITY;
CREATE POLICY telemetry_rollups_owner_policy ON nexora_cloud.telemetry_rollups
  USING (owner_id = nexora_cloud.current_owner_id())
  WITH CHECK (owner_id = nexora_cloud.current_owner_id());

ALTER TABLE nexora_cloud.deletion_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE nexora_cloud.deletion_requests FORCE ROW LEVEL SECURITY;
CREATE POLICY deletion_requests_owner_policy ON nexora_cloud.deletion_requests
  USING (owner_id = nexora_cloud.current_owner_id())
  WITH CHECK (owner_id = nexora_cloud.current_owner_id());

REVOKE ALL ON SCHEMA nexora_cloud FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA nexora_cloud FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA nexora_cloud FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA nexora_cloud FROM PUBLIC;

COMMIT;
