BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nexora_cloud_api') THEN
    CREATE ROLE nexora_cloud_api NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nexora_cloud_maintenance') THEN
    CREATE ROLE nexora_cloud_maintenance NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
END;
$$;

ALTER ROLE nexora_cloud_api NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
ALTER ROLE nexora_cloud_maintenance NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;

GRANT nexora_cloud_api, nexora_cloud_maintenance TO CURRENT_USER;
GRANT USAGE ON SCHEMA nexora_cloud TO nexora_cloud_api, nexora_cloud_maintenance;
GRANT EXECUTE ON FUNCTION nexora_cloud.current_owner_id() TO nexora_cloud_api, nexora_cloud_maintenance;
GRANT EXECUTE ON FUNCTION nexora_cloud.reject_event_mutation() TO nexora_cloud_maintenance;

GRANT SELECT, INSERT, UPDATE ON
  nexora_cloud.accounts,
  nexora_cloud.companion_vaults,
  nexora_cloud.devices,
  nexora_cloud.device_key_envelopes,
  nexora_cloud.recovery_key_envelopes,
  nexora_cloud.companion_snapshots,
  nexora_cloud.device_commands,
  nexora_cloud.telemetry_rollups
TO nexora_cloud_api;

GRANT SELECT, INSERT ON nexora_cloud.companion_events TO nexora_cloud_api;
GRANT SELECT, INSERT ON nexora_cloud.deletion_requests TO nexora_cloud_api;
REVOKE UPDATE, DELETE ON nexora_cloud.deletion_requests FROM nexora_cloud_api;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA nexora_cloud TO nexora_cloud_api;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA nexora_cloud TO nexora_cloud_maintenance;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA nexora_cloud TO nexora_cloud_maintenance;

COMMIT;
