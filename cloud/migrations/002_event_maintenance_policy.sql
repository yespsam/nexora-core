BEGIN;

CREATE POLICY companion_events_maintenance_delete_policy
ON nexora_cloud.companion_events
FOR DELETE
USING (owner_id = nexora_cloud.current_owner_id());

COMMIT;
