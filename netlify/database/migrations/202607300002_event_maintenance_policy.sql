-- Event deletion remains owner-scoped and available only to maintenance transactions.

CREATE POLICY companion_events_maintenance_delete_policy
ON nexora_cloud.companion_events
FOR DELETE
USING (owner_id = nexora_cloud.current_owner_id());
