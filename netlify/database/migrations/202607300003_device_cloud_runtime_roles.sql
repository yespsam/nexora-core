BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_roles
    WHERE rolname = CURRENT_USER
      AND (rolsuper OR rolbypassrls)
  ) THEN
    RAISE EXCEPTION 'Netlify Database runtime role must not bypass row-level security';
  END IF;
END;
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'nexora_cloud'
      AND c.relkind IN ('r', 'p')
      AND (NOT c.relrowsecurity OR NOT c.relforcerowsecurity)
  ) THEN
    RAISE EXCEPTION 'Every NEXORA Cloud table must force row-level security';
  END IF;
END;
$$;

-- Netlify Database owns its deploy-scoped connection role and does not allow
-- migrations to create or alter PostgreSQL roles. FORCE ROW LEVEL SECURITY
-- keeps the platform owner subject to app.owner_id policies.
REVOKE ALL ON SCHEMA nexora_cloud FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA nexora_cloud FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA nexora_cloud FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA nexora_cloud FROM PUBLIC;

COMMIT;
