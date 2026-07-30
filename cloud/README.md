# NEXORA CORE Device Cloud

This directory contains the provider-neutral data foundation for future physical NEXORA devices. It is not deployed by the current Netlify production build.

## Storage contract

- PostgreSQL stores accounts, device identities, append-only encrypted event metadata, snapshot indexes, short-lived commands, telemetry rollups, and deletion jobs.
- Object storage holds encrypted companion snapshots and optional encrypted media.
- Companion names, memories, transcripts, and behavior data stay inside AES-256-GCM ciphertext.
- Every device signs its event envelope. The server verifies the active device key before inserting an event.
- The phone is the network gateway for the first pendant release. The pendant does not contain a permanent cloud API key.

## Apply the migration

Use PostgreSQL 16 or newer and an isolated database role with permission to create the `nexora_cloud` schema.

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f cloud/migrations/001_device_cloud_foundation.sql
```

The migration revokes access from `PUBLIC`. A provider-specific follow-up migration must create narrowly scoped runtime and maintenance roles before an API is connected.

Every user-scoped API transaction must set the authenticated owner before accessing data:

```sql
BEGIN;
SET LOCAL app.owner_id = '00000000-0000-0000-0000-000000000000';
-- User-scoped queries run here.
COMMIT;
```

Do not expose PostgreSQL directly to browsers or pendants. The API must validate the event protocol, verify the ES256 device signature, check device revocation, decode base64url fields, and then insert the event in one transaction.

`ES256` signatures use the JOSE raw `R || S` representation: 64 bytes before base64url encoding. Device registration must accept public P-256 JWK values only and reject any JWK containing the private `d` field.

Account and vault deletion runs through a maintenance worker, never through the normal user role. In one transaction the worker sets `app.allow_event_maintenance` to `on`, deletes events before their devices and vault, removes encrypted object-storage keys, and finally marks the independent deletion audit row complete. Object deletion must be retried idempotently before the database request is finalized.

```sql
BEGIN;
SET LOCAL app.allow_event_maintenance = 'on';
-- Delete the requested owner's event rows before device and vault rows.
COMMIT;
```

## Files

- `migrations/001_device_cloud_foundation.sql`: initial PostgreSQL schema and row-level security.
- `../shared/device-cloud-protocol.mjs`: encrypted device-event boundary shared by future clients and APIs.
- `../docs/NEXORA_DEVICE_CLOUD_ARCHITECTURE.md`: product, privacy, retention, and migration decisions.
