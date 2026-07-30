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
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f netlify/database/migrations/202607300001_device_cloud_foundation.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f netlify/database/migrations/202607300002_event_maintenance_policy.sql
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

## Local three-device test

The local harness requires PostgreSQL 16. It creates only the `nexora_core_dev` database and two non-superuser roles.

```bash
npm run cloud:setup
npm run cloud:simulate
```

The simulator generates independent phone, pendant, and desktop P-256 keys. It wraps a real 256-bit vault key, submits 1,000 signed encrypted events, checks duplicate delivery and tenant isolation, rotates the vault key while revoking the pendant, restores the new key through the recovery envelope, and executes account deletion.

Run the development API separately with:

```bash
NEXORA_LOCAL_API_KEY="replace-with-at-least-32-random-characters" \
NEXORA_SUBJECT_PEPPER="use-a-different-32-character-secret" \
npm run cloud:serve
```

The local server exposes `/v1/bootstrap`, `/v1/devices`, `/v1/events`, device revocation, recovery-envelope lookup, and deletion endpoints on `127.0.0.1:4788`. Its `X-Nexora-Local-Key` and `X-Nexora-Owner-Id` headers are a computer-only test harness. They are not production authentication and must never be exposed to the internet. A production service must derive the owner from a verified identity session and use a separately protected maintenance worker.

## Private staging function

`netlify/functions/device-cloud.mjs` provides the disabled-by-default staging adapter at `/api/device-cloud/*`. It uses Netlify Identity for the authenticated subject, Netlify Database for deploy-scoped PostgreSQL branches, derives an internal RLS owner with a server-side HMAC pepper, and rejects state-changing cross-origin requests. See `../docs/NEXORA_PRIVATE_CLOUD_STAGING.md` for environment variables and the gated deployment order.

```bash
NEXORA_SIM_EVENT_COUNT=30 npm run cloud:simulate:function
```

This command runs the Identity-to-Function-to-RLS chain against local PostgreSQL without provisioning a paid cloud resource.

## Files

- `../netlify/database/migrations/202607300001_device_cloud_foundation.sql`: initial PostgreSQL schema and row-level security.
- `../netlify/database/migrations/202607300002_event_maintenance_policy.sql`: owner-scoped event deletion for the maintenance role.
- `../netlify/database/migrations/202607300003_device_cloud_runtime_roles.sql`: no-login API and maintenance roles used with `SET LOCAL ROLE`.
- `setup-local.mjs`: repeatable local database and role setup.
- `local-server.mjs`: localhost-only API harness.
- `simulate-devices.mjs`: three-device encrypted integration test.
- `../netlify/functions/device-cloud.mjs`: disabled-by-default authenticated staging endpoint.
- `../shared/device-cloud-protocol.mjs`: encrypted device-event boundary shared by future clients and APIs.
- `../shared/device-cloud-crypto.mjs`: P-256 keys, ECDH/AES-KW device envelopes, and HKDF recovery envelopes.
- `../docs/NEXORA_DEVICE_CLOUD_ARCHITECTURE.md`: product, privacy, retention, and migration decisions.
