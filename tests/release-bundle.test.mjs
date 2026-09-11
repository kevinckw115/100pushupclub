import { test } from 'node:test';
import assert from 'node:assert/strict';
import { auditText } from '../apps/mobile/scripts/audit-bundle.mjs';
test('export audit rejects privileged credentials without including their value in diagnostics', () => {
  const jwt = role => 'eyJhbGciOiJIUzI1NiJ9.' + Buffer.from(JSON.stringify({role})).toString('base64url') + '.signature';
  for (const source of ['sb_secret_privatefixture', jwt('service_role'), 'postgresql://admin:privatefixture@db.invalid/db', '-----BEGIN PRIVATE KEY-----', 'node:sqlite']) {
    assert.throws(() => auditText(source), error => !error.message.includes(source));
  }
  assert.doesNotThrow(() => auditText('sb_publishable_publicfixture ' + jwt('anon')));
});
