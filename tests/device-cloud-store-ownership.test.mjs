import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../cloud/device-cloud-store.mjs', import.meta.url), 'utf8');

test('every device cloud lookup and mutation is explicitly owner-scoped', () => {
  const statements = [...source.matchAll(/client\.query\(\s*`([\s\S]*?)`/g)]
    .map((match) => match[1].trim())
    .filter((sql) => /^(SELECT|UPDATE|DELETE)/i.test(sql) && /nexora_cloud\./.test(sql));

  assert.ok(statements.length >= 17, 'expected to audit all device cloud SQL paths');
  for (const sql of statements) {
    const deletesOwnerAccount = /^DELETE FROM nexora_cloud\.accounts\s+WHERE id = \$1$/i.test(
      sql.replace(/\s+/g, ' ')
    );
    assert.ok(
      deletesOwnerAccount || /owner_id/.test(sql),
      `database statement is missing an explicit owner predicate: ${sql.split('\n')[0]}`
    );
  }

  assert.match(source, /WHERE public_id = \$1 AND owner_id = \$2/);
  assert.match(source, /WHERE d\.id = \$1 AND d\.owner_id = \$3/);
  assert.match(source, /WHERE id = \$1 AND owner_id = \$2/);
  assert.match(source, /UPDATE nexora_cloud\.device_command_agents\s+SET last_seen_at = now\(\)\s+WHERE id = \$1 AND owner_id = \$2 AND vault_id = \$3/);
  assert.doesNotMatch(source, /vaultForOwner\(client,\s*(?:publicId|value\?\.vaultId)/);
});
