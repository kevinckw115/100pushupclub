import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { localEnvironment, request, removeAccount } from './environment.mjs';

test('real email OTP rejects invalid/expired/reused codes; recovery refresh and sign-out work', async () => {
  const config = localEnvironment(), email = `otp-${randomUUID()}@example.invalid`;
  const db = new pg.Client({ connectionString: config.db }); await db.connect();
  let user;
  try {
    const created = await request(config, '/auth/v1/admin/users', { admin: true, body: { email, email_confirm: true } });
    assert.equal(created.status, 200); user = { id: created.data.id };
    const makeCode = async () => {
      const response = await request(config, '/auth/v1/admin/generate_link', { admin: true, body: { type: 'magiclink', email } });
      assert.equal(response.status, 200); assert.match(response.data.email_otp, /^\d+$/);
      return response.data.email_otp;
    };
    const expired = await makeCode();
    await db.query("UPDATE auth.users SET confirmation_sent_at=now()-interval '2 hours',recovery_sent_at=now()-interval '2 hours' WHERE id=$1", [user.id]);
    const expiredResult = await request(config, '/auth/v1/verify', { body: { email, token: expired, type: 'email' } });
    assert.equal(expiredResult.status, 403, 'expired code denied');
    const code = await makeCode();
    const wrong = await request(config, '/auth/v1/verify', { body: { email, token: '0000000000', type: 'email' } });
    assert.equal(wrong.status, 403);
    const accepted = await request(config, '/auth/v1/verify', { body: { email, token: code, type: 'email' } });
    assert.equal(accepted.status, 200); assert.equal(accepted.data.user.id, user.id);
    const reused = await request(config, '/auth/v1/verify', { body: { email, token: code, type: 'email' } });
    assert.equal(reused.status, 403);
    const refreshed = await request(config, '/auth/v1/token?grant_type=refresh_token', { body: { refresh_token: accepted.data.refresh_token } });
    assert.equal(refreshed.status, 200); assert.equal(refreshed.data.user.id, user.id);
    const logout = await request(config, '/auth/v1/logout?scope=local', { token: refreshed.data.access_token });
    assert.equal(logout.status, 204);
    const revoked = await request(config, '/auth/v1/token?grant_type=refresh_token', { body: { refresh_token: refreshed.data.refresh_token } });
    assert.equal(revoked.status, 400);
  } finally { if (user) await removeAccount(config, user); await db.end(); }
});
