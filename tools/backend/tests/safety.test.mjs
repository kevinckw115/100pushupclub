import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { account, localEnvironment, removeAccount, request } from './environment.mjs';
const terms = 'community-v1-2026-09-11';
test('visible-only reports, bilateral blocks, participation and audited staff actions enforce real sessions', { timeout: 120000 }, async () => {
  const config = localEnvironment(), db = new pg.Client({ connectionString: config.db }), users = [];
  await db.connect(); let circle;
  const call = (user, name, body = {}) => request(config, '/rest/v1/rpc/' + name, { token: user?.token, body });
  const op = (user, name, fields) => call(user, name, { envelope: { operation_id: randomUUID(), ...fields } });
  const feed = user => call(user, 'read_club', { scope_id: 'world' });
  const create = (user, epoch = '1', quantity = 10) => { const now = new Date().toISOString(); return op(user, 'mutate_checkin', { kind: 'create', mutation_id: randomUUID(), checkin_id: randomUUID(), quantity, occurred_at: now, recorded_timezone: 'UTC', local_date: now.slice(0, 10), source: 'native', requested_public_epoch: epoch, operation_id: undefined }); };
  try {
    for (let i = 0; i < 4; i++) { const user = await account(config); users.push(user); assert.equal((await call(user, 'bootstrap_profile', { operation_id: randomUUID() })).status, 200); }
    const [a, b, hidden, staff] = users;
    for (const user of [a, b]) {
      assert.equal((await op(user, 'update_profile', { public_enabled: true, expected_consent_epoch: '0' })).data.code, 'TERMS_REQUIRED');
      assert.equal((await op(user, 'update_profile', { accepted_terms_version: 'unknown' })).status, 400);
      const consent = await op(user, 'update_profile', { public_enabled: true, expected_consent_epoch: '0', accepted_terms_version: terms });
      assert.equal(consent.status, 200, JSON.stringify(consent.data)); assert.equal(consent.data.profile.participation_terms_version, terms);
      assert.equal((await create(user)).data.effective_public, true);
      user.actor = (await db.query('select public_actor_id from app_private.profiles where user_id=$1', [user.id])).rows[0].public_actor_id;
    }
    const publicRows = (await feed(null)).data.items;
    const aRow = publicRows.find(r => r.actor_id === a.actor), bRow = publicRows.find(r => r.actor_id === b.actor);
    assert.ok(aRow && bRow); assert.equal((await feed(a)).data.pushups_past_24_hours, '20');
    const privateActor = (await db.query('select public_actor_id from app_private.profiles where user_id=$1', [hidden.id])).rows[0].public_actor_id;
    assert.equal((await op(a, 'block_user', { actor_id: privateActor })).status, 404);
    assert.equal((await op(a, 'block_user', { actor_id: a.actor })).status, 404);
    assert.equal((await op(null, 'report_subject', { subject_type: 'checkin', subject_id: bRow.id, reason: 'abuse' })).status, 401);
    assert.equal((await op(a, 'report_subject', { subject_type: 'alias', subject_id: privateActor, reason: 'abuse' })).status, 404);
    // Invalid/nonvisible reports count toward the bounded abuse budget; reset this fixture's budget for the exact ten-report boundary below.
    await db.query("delete from app_private.request_budgets where user_id=$1 and operation='report_subject'", [a.id]);
    const reportInput = { operation_id: randomUUID(), subject_type: 'checkin', subject_id: bRow.id, reason: 'abuse' };
    const reported = await op(a, 'report_subject', reportInput); assert.equal(reported.status, 200); assert.equal(reported.data.received, true);
    assert.deepEqual((await op(a, 'report_subject', reportInput)).data, reported.data);
    assert.equal((await op(a, 'report_subject', { ...reportInput, reason: 'other' })).data.code, 'IDEMPOTENCY_KEY_REUSED');
    const blockInput = { operation_id: randomUUID(), actor_id: b.actor }, blocked = await op(a, 'block_user', blockInput);
    assert.equal(blocked.status, 200); assert.equal(blocked.data.blocked, true); assert.deepEqual((await op(a, 'block_user', blockInput)).data, blocked.data);
    assert.equal((await feed(a)).data.pushups_past_24_hours, '10'); assert.equal((await feed(b)).data.pushups_past_24_hours, '10'); assert.equal((await feed(null)).data.pushups_past_24_hours, '20');
    const list = (await call(a, 'list_blocks')).data; assert.deepEqual(list.items.map(r => r.actor_id), [b.actor]); assert.deepEqual(Object.keys(list.items[0]).sort(), ['actor_id', 'alias']);
    assert.equal((await op(a, 'report_subject', { subject_type: 'alias', subject_id: b.actor, reason: 'abuse' })).status, 404);
    assert.equal((await call(b, 'list_blocks')).data.items.length, 0);
    assert.equal((await op(a, 'unblock_user', { actor_id: b.actor })).data.blocked, false); assert.equal((await feed(a)).data.pushups_past_24_hours, '20');
    await db.query("update app_private.request_budgets set used=1 where user_id=$1 and operation='report_subject'", [a.id]);
    for (let i = 0; i < 9; i++) assert.equal((await op(a, 'report_subject', { subject_type: 'alias', subject_id: b.actor, reason: 'other' })).status, 200);
    const limited = await op(a, 'report_subject', { subject_type: 'alias', subject_id: b.actor, reason: 'abuse' }); assert.equal(limited.status, 429); assert.ok(Number(limited.retryAfter) > 0);
    assert.deepEqual((await op(a, 'report_subject', reportInput)).data, reported.data);

    circle = randomUUID(); await db.query("insert into app_private.circles(id,owner_id,name,timezone) values($1,$2,'Private test circle','UTC')", [circle, a.id]);
    await db.query('insert into app_private.circle_memberships(circle_id,user_id) values($1,$2),($1,$3)', [circle, a.id, hidden.id]);
    assert.equal((await op(hidden, 'report_subject', { subject_type: 'circle_name', subject_id: circle, reason: 'inappropriate_name' })).status, 200);
    assert.equal((await op(b, 'report_subject', { subject_type: 'circle_name', subject_id: circle, reason: 'other' })).status, 404);
    assert.equal((await op(hidden, 'block_user', { actor_id: a.actor })).status, 200);
    await db.query('update app_private.circle_memberships set left_at=now() where circle_id=$1 and user_id=$2', [circle, hidden.id]);
    assert.equal((await op(hidden, 'report_subject', { subject_type: 'circle_name', subject_id: circle, reason: 'other' })).status, 404);

    assert.equal((await call(a, 'staff_list_reports')).status, 403);
    const moderate = fields => op(staff, 'staff_moderate', { reason: 'Verified test moderation reason', ...fields });
    const hideInput = { operation_id: randomUUID(), action: 'hide_entry', subject_id: bRow.id };
    assert.equal((await op(a, 'staff_moderate', { ...hideInput, reason: 'Attempt without staff access' })).status, 403);
    await db.query('insert into app_private.staff_members(user_id) values($1)', [staff.id]);
    const queue = await call(staff, 'staff_list_reports', { limit: 2 }); assert.equal(queue.status, 200); assert.equal(queue.data.items.length, 2); assert.ok(queue.data.next_report);
    assert.equal(JSON.stringify(queue.data).includes(a.id), false); assert.equal(JSON.stringify(queue.data).includes('reporter_id'), false);
    assert.equal((await call(staff, 'staff_list_reports', { after_report: queue.data.next_report, limit: 2 })).data.items.length, 2);
    const hiddenEntry = await moderate(hideInput); assert.equal(hiddenEntry.status, 200); assert.deepEqual((await moderate(hideInput)).data, hiddenEntry.data);
    assert.equal((await feed(null)).data.pushups_past_24_hours, '10');
    assert.equal((await moderate({ action: 'require_alias', subject_id: a.actor })).status, 200);
    const required = (await call(a, 'get_profile')).data.profile; assert.equal(required.alias_change_required, true); assert.equal(required.public_enabled, false);
    assert.equal((await op(a, 'update_profile', { public_enabled: true, expected_consent_epoch: required.consent_epoch })).data.code, 'ALIAS_CHANGE_REQUIRED');
    const renamed = await op(a, 'update_profile', { alias: 'renamed_' + randomUUID().slice(0, 8), public_enabled: true, expected_consent_epoch: required.consent_epoch });
    assert.equal(renamed.status, 200); assert.equal(renamed.data.profile.alias_change_required, false);
    assert.equal((await feed(null)).data.pushups_past_24_hours, '0');
    assert.equal((await create(a, renamed.data.profile.consent_epoch, 5)).status, 200);
    assert.equal((await moderate({ action: 'require_circle_name', subject_id: circle })).status, 200);
    assert.deepEqual((await db.query('select name,name_change_required from app_private.circles where id=$1', [circle])).rows[0], { name: 'Name needs review', name_change_required: true });
    assert.equal((await moderate({ action: 'suspend', subject_id: b.actor })).status, 200); assert.equal((await call(b, 'get_profile')).status, 403);
    assert.equal((await create(b, null)).status, 403);
    assert.equal((await moderate({ action: 'restore', subject_id: b.actor })).status, 200); assert.equal((await call(b, 'get_profile')).data.profile.public_enabled, false);
    assert.equal((await moderate({ action: 'resolve_report', subject_id: reported.data.report_id, resolution: 'resolved' })).status, 200);
    assert.equal((await db.query('select status from app_private.reports where id=$1', [reported.data.report_id])).rows[0].status, 'resolved');
    await assert.rejects(db.query("update app_private.moderation_audit set reason='changed'"), /append-only/);
    await assert.rejects(db.query('delete from app_private.moderation_audit'), /append-only/);
    const currentEntry = (await feed(null)).data.items[0].id, failedInput = { operation_id: randomUUID(), action: 'hide_entry', subject_id: currentEntry };
    await db.query("create function app_private.test_audit_failure() returns trigger language plpgsql as $$ begin raise exception 'AUDIT_WRITE_FAILURE'; end $$; create trigger test_audit_failure before insert on app_private.moderation_audit for each row execute function app_private.test_audit_failure();");
    try {
      const failed = await moderate(failedInput); assert.equal(failed.status, 503); assert.equal(JSON.stringify(failed.data).includes('AUDIT_WRITE_FAILURE'), false);
      assert.equal((await feed(null)).data.pushups_past_24_hours, '5');
      assert.equal((await db.query('select 1 from app_private.operation_receipts where user_id=$1 and operation_id=$2', [staff.id, failedInput.operation_id])).rowCount, 0);
    } finally { await db.query('drop trigger test_audit_failure on app_private.moderation_audit; drop function app_private.test_audit_failure();'); }
    assert.equal((await moderate(failedInput)).status, 200);
    await db.query('update app_private.staff_members set enabled=false where user_id=$1', [staff.id]);
    assert.equal((await moderate(failedInput)).status, 403); assert.equal((await call(staff, 'staff_list_reports')).status, 403);
  } finally { if (circle) await db.query('delete from app_private.circles where id=$1', [circle]); await db.end(); for (const user of users) await removeAccount(config, user); }
});
