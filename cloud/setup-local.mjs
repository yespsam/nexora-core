import { readFile } from 'node:fs/promises';
import { userInfo } from 'node:os';

import pg from 'pg';

const { Client } = pg;
const databaseName = process.env.NEXORA_CLOUD_DATABASE || 'nexora_core_dev';
const socketHost = process.env.PGHOST || '/tmp';
const adminUser = process.env.PGUSER || userInfo().username;

if (!/^[a-z][a-z0-9_]{2,62}$/.test(databaseName)) {
  throw new Error('NEXORA_CLOUD_DATABASE must be a safe PostgreSQL identifier');
}

function client(database, user = adminUser) {
  if (process.env.DATABASE_ADMIN_URL) {
    return new Client({ connectionString: process.env.DATABASE_ADMIN_URL, database });
  }
  return new Client({ database, host: socketHost, user });
}

async function ensureDatabase() {
  const connection = client('postgres');
  await connection.connect();
  try {
    const existing = await connection.query('SELECT 1 FROM pg_database WHERE datname = $1', [databaseName]);
    if (!existing.rowCount) await connection.query(`CREATE DATABASE "${databaseName}"`);
  } finally {
    await connection.end();
  }
}

async function applyFoundation() {
  const connection = client(databaseName);
  await connection.connect();
  try {
    const existing = await connection.query("SELECT to_regclass('nexora_cloud.accounts') AS table_name");
    if (!existing.rows[0].table_name) {
      const migration = await readFile(new URL(
        '../netlify/database/migrations/202607300001_device_cloud_foundation.sql',
        import.meta.url
      ), 'utf8');
      await connection.query(migration);
    }
    const maintenancePolicy = await connection.query(`
      SELECT 1
      FROM pg_policies
      WHERE schemaname = 'nexora_cloud'
        AND tablename = 'companion_events'
        AND policyname = 'companion_events_maintenance_delete_policy'
    `);
    if (!maintenancePolicy.rowCount) {
      const migration = await readFile(new URL(
        '../netlify/database/migrations/202607300002_event_maintenance_policy.sql',
        import.meta.url
      ), 'utf8');
      await connection.query(migration);
    }
    const roles = await readFile(new URL('./local/runtime-roles.sql', import.meta.url), 'utf8');
    const roleSql = databaseName === 'nexora_core_dev'
      ? roles
      : roles.replaceAll('nexora_core_dev', databaseName);
    await connection.query(roleSql);
  } finally {
    await connection.end();
  }
}

await ensureDatabase();
await applyFoundation();

console.log(`NEXORA device cloud database ready: ${databaseName}`);
console.log(`API role: postgresql://nexora_cloud_api@localhost/${databaseName}`);
console.log(`Maintenance role: postgresql://nexora_cloud_maintenance@localhost/${databaseName}`);
