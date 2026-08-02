-- Authenticated desktop agents receive only encrypted, short-lived commands.

CREATE TABLE nexora_cloud.device_command_agents (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL,
  vault_id uuid NOT NULL,
  display_name text NOT NULL CHECK (length(display_name) BETWEEN 1 AND 80),
  credential_hash bytea NOT NULL CHECK (octet_length(credential_hash) = 32),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz,
  revoked_at timestamptz,
  UNIQUE (owner_id, credential_hash),
  UNIQUE (id, vault_id, owner_id),
  FOREIGN KEY (vault_id, owner_id)
    REFERENCES nexora_cloud.companion_vaults(id, owner_id) ON DELETE CASCADE
);

CREATE INDEX device_command_agents_owner_status_idx
  ON nexora_cloud.device_command_agents (owner_id, status, created_at DESC);

ALTER TABLE nexora_cloud.device_commands
  ALTER COLUMN target_device_id DROP NOT NULL;

ALTER TABLE nexora_cloud.device_commands
  ADD COLUMN target_agent_id uuid,
  ADD COLUMN delivered_at timestamptz,
  ADD CONSTRAINT device_commands_target_agent_fkey
    FOREIGN KEY (target_agent_id, vault_id, owner_id)
    REFERENCES nexora_cloud.device_command_agents(id, vault_id, owner_id) ON DELETE CASCADE,
  ADD CONSTRAINT device_commands_exactly_one_target_check
    CHECK (num_nonnulls(target_device_id, target_agent_id) = 1);

CREATE INDEX device_commands_agent_pending_idx
  ON nexora_cloud.device_commands (target_agent_id, status, expires_at)
  WHERE target_agent_id IS NOT NULL;

ALTER TABLE nexora_cloud.device_command_agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE nexora_cloud.device_command_agents FORCE ROW LEVEL SECURITY;
CREATE POLICY device_command_agents_owner_policy ON nexora_cloud.device_command_agents
  USING (owner_id = nexora_cloud.current_owner_id())
  WITH CHECK (owner_id = nexora_cloud.current_owner_id());

CREATE OR REPLACE FUNCTION nexora_cloud.authenticate_device_command_agent(
  requested_agent_id uuid,
  requested_credential_hash bytea
)
RETURNS TABLE (agent_id uuid, owner_id uuid, vault_id uuid, public_vault_id text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, nexora_cloud
AS $$
  WITH authenticated AS (
    UPDATE nexora_cloud.device_command_agents AS agent
    SET last_seen_at = now()
    WHERE agent.id = requested_agent_id
      AND agent.credential_hash = requested_credential_hash
      AND agent.status = 'active'
      AND agent.revoked_at IS NULL
    RETURNING agent.id, agent.owner_id, agent.vault_id
  )
  SELECT authenticated.id, authenticated.owner_id, authenticated.vault_id, vault.public_id
  FROM authenticated
  JOIN nexora_cloud.companion_vaults AS vault ON vault.id = authenticated.vault_id
$$;

REVOKE ALL ON FUNCTION nexora_cloud.authenticate_device_command_agent(uuid, bytea) FROM PUBLIC;
REVOKE ALL ON TABLE nexora_cloud.device_command_agents FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nexora_cloud_api') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE ON nexora_cloud.device_command_agents TO nexora_cloud_api';
    EXECUTE 'GRANT EXECUTE ON FUNCTION nexora_cloud.authenticate_device_command_agent(uuid, bytea) TO nexora_cloud_api';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nexora_cloud_maintenance') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON nexora_cloud.device_command_agents TO nexora_cloud_maintenance';
  END IF;
END;
$$;
