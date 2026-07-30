-- Narrow maintenance entry points for cancellation and due-deletion discovery.

CREATE UNIQUE INDEX IF NOT EXISTS deletion_requests_pending_scope_idx
ON nexora_cloud.deletion_requests (
  owner_id,
  scope,
  COALESCE(vault_id, '00000000-0000-0000-0000-000000000000'::uuid)
)
WHERE status IN ('scheduled', 'running', 'failed');

CREATE OR REPLACE FUNCTION nexora_cloud.cancel_deletion_request(
  requested_owner_id uuid,
  request_id uuid
)
RETURNS TABLE (
  id uuid,
  owner_id uuid,
  scope text,
  status text,
  execute_after timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, nexora_cloud
AS $$
BEGIN
  IF requested_owner_id IS DISTINCT FROM nexora_cloud.current_owner_id() THEN
    RAISE EXCEPTION 'owner context mismatch' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  UPDATE nexora_cloud.deletion_requests AS request
  SET status = 'cancelled', completed_at = now()
  WHERE request.id = request_id
    AND request.owner_id = requested_owner_id
    AND request.status IN ('scheduled', 'failed')
    AND request.execute_after > now()
  RETURNING request.id, request.owner_id, request.scope, request.status, request.execute_after;
END;
$$;

CREATE OR REPLACE FUNCTION nexora_cloud.list_due_deletion_requests(request_limit integer DEFAULT 3)
RETURNS TABLE (id uuid, owner_id uuid)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, nexora_cloud
AS $$
  SELECT request.id, request.owner_id
  FROM nexora_cloud.deletion_requests AS request
  WHERE request.status IN ('scheduled', 'failed')
    AND request.execute_after <= now()
  ORDER BY request.execute_after ASC, request.id ASC
  LIMIT LEAST(10, GREATEST(1, request_limit))
$$;

REVOKE ALL ON FUNCTION nexora_cloud.cancel_deletion_request(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION nexora_cloud.list_due_deletion_requests(integer) FROM PUBLIC;
