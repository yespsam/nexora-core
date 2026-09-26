-- User-scoped generation jobs and an independently editable companion profile.
CREATE TABLE IF NOT EXISTS nexora_cloud.companion_studio_jobs (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES nexora_cloud.accounts(id) ON DELETE CASCADE,
  agent_id uuid NOT NULL REFERENCES nexora_cloud.device_command_agents(id) ON DELETE CASCADE,
  idempotency_key uuid NOT NULL,
  state text NOT NULL DEFAULT 'queued_preview',
  data jsonb NOT NULL,
  progress integer NOT NULL DEFAULT 0,
  error_code text,
  lease_until timestamptz,
  next_run_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(owner_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS companion_studio_jobs_due ON nexora_cloud.companion_studio_jobs(next_run_at);
CREATE TABLE IF NOT EXISTS nexora_cloud.companion_studio_profiles (
  owner_id uuid PRIMARY KEY REFERENCES nexora_cloud.accounts(id) ON DELETE CASCADE,
  active_job_id uuid REFERENCES nexora_cloud.companion_studio_jobs(id) ON DELETE SET NULL,
  profile jsonb NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE nexora_cloud.companion_studio_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE nexora_cloud.companion_studio_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY studio_jobs_owner ON nexora_cloud.companion_studio_jobs
  USING(owner_id = nexora_cloud.current_owner_id()) WITH CHECK(owner_id = nexora_cloud.current_owner_id());
CREATE POLICY studio_profiles_owner ON nexora_cloud.companion_studio_profiles
  USING(owner_id = nexora_cloud.current_owner_id()) WITH CHECK(owner_id = nexora_cloud.current_owner_id());
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='nexora_cloud_api') THEN
  GRANT SELECT, INSERT, UPDATE, DELETE ON nexora_cloud.companion_studio_jobs, nexora_cloud.companion_studio_profiles TO nexora_cloud_api;
 END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='nexora_cloud_maintenance') THEN
  GRANT SELECT, INSERT, UPDATE, DELETE ON nexora_cloud.companion_studio_jobs, nexora_cloud.companion_studio_profiles TO nexora_cloud_maintenance;
  CREATE POLICY studio_jobs_worker ON nexora_cloud.companion_studio_jobs TO nexora_cloud_maintenance USING(true) WITH CHECK(true);
 END IF;
END $$;
CREATE OR REPLACE FUNCTION nexora_cloud.studio_daily_usage(requested_owner uuid)
RETURNS TABLE(total bigint, own bigint) LANGUAGE sql SECURITY DEFINER
SET search_path = pg_catalog, nexora_cloud AS $$
 SELECT count(*), count(*) FILTER(WHERE owner_id=requested_owner)
 FROM nexora_cloud.companion_studio_jobs WHERE created_at>now()-interval '24 hours'
$$;
REVOKE ALL ON FUNCTION nexora_cloud.studio_daily_usage(uuid) FROM PUBLIC;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='nexora_cloud_api') THEN
  GRANT EXECUTE ON FUNCTION nexora_cloud.studio_daily_usage(uuid) TO nexora_cloud_api;
 END IF;
END $$;
