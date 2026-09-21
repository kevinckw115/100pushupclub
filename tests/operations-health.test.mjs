import test from 'node:test';
import assert from 'node:assert/strict';
import { healthFailures, validateHostedOperations } from '../tools/backend/scripts/operations-health.mjs';
const key = claims => 'test.' + Buffer.from(JSON.stringify(claims)).toString('base64url') + '.test';
const env = { DELETION_API_URL: 'https://ggeyfolfedercmfvwsqx.supabase.co', DELETION_DATABASE_URL: 'postgresql://postgres.ggeyfolfedercmfvwsqx:private-password@aws-0-example.pooler.supabase.com:5432/postgres?sslmode=verify-full', DELETION_ADMIN_KEY: key({ role: 'service_role', ref: 'ggeyfolfedercmfvwsqx' }) };
test('hosted operations reject wrong project, public key and unverified database TLS without leaking credentials', () => {
  assert.doesNotThrow(() => validateHostedOperations(env));
  for (const override of [
    { DELETION_API_URL: 'https://other.supabase.co' },
    { DELETION_DATABASE_URL: env.DELETION_DATABASE_URL.replace('verify-full', 'disable') },
    { DELETION_DATABASE_URL: env.DELETION_DATABASE_URL.replace('postgres.ggeyfolfedercmfvwsqx', 'postgres.other') },
    { DELETION_ADMIN_KEY: key({ role: 'anon', ref: 'ggeyfolfedercmfvwsqx' }) },
    { DELETION_ADMIN_KEY: key({ role: 'service_role', ref: 'other' }) },
    { OPERATIONS_HEARTBEAT_URL: 'http://example.com/secret' },
  ]) assert.throws(() => validateHostedOperations({ ...env, ...override }), error => !error.message.includes('private-password') && !error.message.includes(env.DELETION_ADMIN_KEY));
});
test('cleanup failures and one-day backlog alert well before the seven-day target', () => {
  const m = { pending_deletions: 1, failed_deletions: 0, oldest_deletion_seconds: 86399, open_reports: 0 };
  assert.deepEqual(healthFailures(m), []);
  assert.deepEqual(healthFailures({ ...m, oldest_deletion_seconds: 86400 }), ['DELETION_OLDER_THAN_ONE_DAY']);
  assert.deepEqual(healthFailures({ ...m, failed_deletions: 1 }), ['DELETION_FAILED']);
  assert.deepEqual(healthFailures({ ...m, pending_deletions: -1 }), ['METRICS_INVALID']);
});
