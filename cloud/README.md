# NEXORA CORE Device Cloud

This directory contains the provider-neutral data foundation for physical NEXORA devices. The Netlify functions are deployed behind disabled-by-default feature flags; production traffic does not use this path yet.

## Storage contract

- PostgreSQL stores accounts, device identities, append-only encrypted event metadata, snapshot indexes, short-lived commands, telemetry rollups, and deletion jobs.
- Object storage holds encrypted companion snapshots and optional encrypted media.
- Companion names, memories, transcripts, and behavior data stay inside AES-256-GCM ciphertext.
- Every device signs its event envelope. The server verifies the active device key before inserting an event.
- The phone is the network gateway for the first pendant release. The pendant does not contain a permanent cloud API key.

## Apply the migration

Use PostgreSQL 16 or newer and an isolated database role with permission to create the `nexora_cloud` schema.

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f netlify/database/migrations/202607300001_device_cloud_foundation.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f netlify/database/migrations/202607300002_event_maintenance_policy.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f netlify/database/migrations/202607300003_device_cloud_runtime_roles.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f netlify/database/migrations/202607300004_device_cloud_data_lifecycle.sql
```

The migration revokes access from `PUBLIC`. A provider-specific follow-up migration must create narrowly scoped runtime and maintenance roles before an API is connected.

Every user-scoped API transaction must set the authenticated owner before accessing data:

```sql
BEGIN;
SET LOCAL app.owner_id = '00000000-0000-0000-0000-000000000000';
-- User-scoped queries run here.
COMMIT;
```

Managed provider connections may have privileges that bypass PostgreSQL RLS. Every application query must therefore also include an explicit `owner_id` predicate derived from the authenticated server-side identity. RLS remains defense in depth and is not the sole tenant boundary.

Do not expose PostgreSQL directly to browsers or pendants. The API must validate the event protocol, verify the ES256 device signature, check device revocation, decode base64url fields, and then insert the event in one transaction.

`ES256` signatures use the JOSE raw `R || S` representation: 64 bytes before base64url encoding. Device registration must accept public P-256 JWK values only and reject any JWK containing the private `d` field.

Account and vault deletion runs through a maintenance worker, never through the normal user role. In one transaction the worker sets `app.allow_event_maintenance` to `on`, deletes events before their devices and vault, removes encrypted object-storage keys, and finally marks the independent deletion audit row complete. Object deletion must be retried idempotently before the database request is finalized.

```sql
BEGIN;
SET LOCAL app.allow_event_maintenance = 'on';
-- Delete the requested owner's event rows before device and vault rows.
COMMIT;
```

## Local three-device test

The local harness requires PostgreSQL 16. It creates only the `nexora_core_dev` database and two non-superuser roles.

```bash
npm run cloud:setup
npm run cloud:simulate
```

The simulator generates independent phone, pendant, and desktop P-256 keys. It wraps a real 256-bit vault key, submits signed encrypted events, stores and decrypts encrypted snapshots, compacts five same-month snapshots to the newest three, checks duplicate delivery and tenant isolation, rotates the vault key while revoking the pendant, restores the new key, verifies object-store failure rollback, and executes account deletion across PostgreSQL and object storage.

Run the development API separately with:

```bash
NEXORA_LOCAL_API_KEY="replace-with-at-least-32-random-characters" \
NEXORA_SUBJECT_PEPPER="use-a-different-32-character-secret" \
npm run cloud:serve
```

The local server exposes `/v1/bootstrap`, `/v1/devices`, `/v1/events`, `/v1/snapshots`, device revocation, recovery-envelope lookup, and deletion/cancellation endpoints on `127.0.0.1:4788`. Its `X-Nexora-Local-Key` and `X-Nexora-Owner-Id` headers are a computer-only test harness. They are not production authentication and must never be exposed to the internet. A production service derives the owner from a verified identity session and uses the separately flagged maintenance worker.

## Private staging function

`netlify/functions/device-cloud.mjs` provides the disabled-by-default staging adapter at `/api/device-cloud/*`. It uses Netlify Identity for the authenticated subject, Netlify Database for deploy-scoped PostgreSQL branches, derives an internal owner with a server-side HMAC pepper, explicitly scopes every data query to that owner, and rejects state-changing cross-origin requests. See `../docs/NEXORA_PRIVATE_CLOUD_STAGING.md` for environment variables and the gated deployment order.

Encrypted snapshots use `POST /api/device-cloud/snapshots` and `GET /api/device-cloud/snapshots/latest`; only AES-256-GCM ciphertext crosses the boundary. Deletion requests use a seven-day grace period and may be cancelled before they become due. `device-cloud-maintenance.mjs` runs hourly only when both cloud and maintenance flags are enabled, has no public URL, and removes encrypted objects before marking database deletion complete.

```bash
NEXORA_SIM_EVENT_COUNT=30 npm run cloud:simulate:function
```

This command runs the Identity-to-Function-to-RLS chain against local PostgreSQL without provisioning a paid cloud resource.

## Files

- `../netlify/database/migrations/202607300001_device_cloud_foundation.sql`: initial PostgreSQL schema and row-level security.
- `../netlify/database/migrations/202607300002_event_maintenance_policy.sql`: owner-scoped event deletion for the maintenance role.
- `../netlify/database/migrations/202607300003_device_cloud_runtime_roles.sql`: managed-runtime guard that verifies forced RLS and public revocation without altering Netlify-owned roles.
- `../netlify/database/migrations/202607300004_device_cloud_data_lifecycle.sql`: pending-delete uniqueness, cancellation, and narrow due-job discovery.
- `setup-local.mjs`: repeatable local database and role setup.
- `local-server.mjs`: localhost-only API harness.
- `simulate-devices.mjs`: three-device encrypted integration test.
- `../netlify/functions/device-cloud.mjs`: disabled-by-default authenticated staging endpoint.
- `../netlify/functions/device-cloud-maintenance.mjs`: disabled-by-default hourly deletion worker.
- `../shared/device-cloud-protocol.mjs`: encrypted device-event boundary shared by future clients and APIs.
- `../shared/device-cloud-crypto.mjs`: P-256 keys, ECDH/AES-KW device envelopes, and HKDF recovery envelopes.
- `../docs/NEXORA_DEVICE_CLOUD_ARCHITECTURE.md`: product, privacy, retention, and migration decisions.
