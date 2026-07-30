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

-- Netlify executes migrations with a platform-owned administrative role and
-- gives deployed code a branch-scoped connection. Migrations cannot create or
-- alter platform roles, so the application boundary is forced RLS plus the
-- server-derived app.owner_id set at the start of every transaction.
REVOKE ALL ON SCHEMA nexora_cloud FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA nexora_cloud FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA nexora_cloud FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA nexora_cloud FROM PUBLIC;
