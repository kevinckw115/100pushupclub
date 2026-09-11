import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import pg from 'pg';
import { account, localEnvironment, removeAccount, request } from './environment.mjs';

async function fixture() {
  const config = localEnvironment(), db = new pg.Client({ connectionString: config.db }), users = [], circles = [];
  await db.connect();
  const call = (user, name, body = {}) => request(config, '/rest/v1/rpc/' + name, { token: user?.token, body });
  const op = (user, name, fields) => call(user, name, { envelope: { operation_id: randomUUID(), ...fields } });
  const user = async (consent = true) => {
    const value = await account(config); users.push(value);
    ok(await call(value, 'bootstrap_profile', { operation_id: randomUUID() }));
    if (consent) ok(await op(value, 'update_profile', { accepted_terms_version: 'community-v1-2026-09-11' }));
    return value;
  };
  const create = async (owner, name = 'Morning circle', timezone = 'UTC') => {
    const result = ok(await op(owner, 'create_circle', { name, timezone, accept_circle_sharing: true }));
    circles.push(result.circle.id); return result.circle;
  };
  const invite = async (owner, circle) => ok(await op(owner, 'create_invite', { circle_id: circle.id })).invite;
  const join = (member, code, fields = {}) => op(member, 'join_circle', { code, accept_circle_sharing: true, ...fields });
  const manage = (owner, circle, action, fields = {}) => op(owner, 'manage_circle', { circle_id: circle.id, action, ...fields });
  const cleanup = async () => {
    await db.query('delete from app_private.circles where owner_id=any($1::uuid[])', [users.map(u => u.id)]);
    await db.end(); for (const value of users) await removeAccount(config, value);
  };
  return { config, db, users, circles, call, op, user, create, invite, join, manage, cleanup };
}
function ok(result) { assert.equal(result.status, 200, JSON.stringify(result.data)); return result.data; }

test('checked circles enforce consent, opaque invitations, current membership and atomic owner actions', { timeout: 120000 }, async () => {
  const f = await fixture(); const { db, call, op, create, invite, join, manage } = f;
  try {
    const a = await f.user(), b = await f.user(), stranger = await f.user(false);
    assert.equal((await call(null, 'list_circles')).status, 401);
    assert.equal((await op(stranger, 'create_circle', { name: 'No consent', timezone: 'UTC', accept_circle_sharing: true })).data.code, 'PARTICIPATION_REQUIRED');
    assert.equal((await op(a, 'create_circle', { name: 'No consent', timezone: 'UTC', accept_circle_sharing: false })).status, 400);
    assert.equal((await op(a, 'create_circle', { name: 'Bad zone', timezone: 'Mars/Base', accept_circle_sharing: true })).data.code, 'INVALID_TIMEZONE');
    const createInput = { operation_id: randomUUID(), name: 'First circle', timezone: 'America/Los_Angeles', accept_circle_sharing: true };
    const created = ok(await op(a, 'create_circle', createInput)), circle = created.circle;
    assert.deepEqual(ok(await op(a, 'create_circle', createInput)), created);
    assert.equal((await op(a, 'create_circle', { ...createInput, name: 'Changed circle' })).data.code, 'IDEMPOTENCY_KEY_REUSED');
    assert.match(circle.member_id, /^m_[0-9a-f]{32}$/); assert.equal(circle.member_count, 1); assert.equal(circle.is_owner, true);
    assert.equal((await call(stranger, 'read_circle_today', { circle_id: circle.id })).status, 404);
    assert.equal((await op(b, 'create_invite', { circle_id: circle.id })).status, 404);
    const invitationInput = { operation_id: randomUUID(), circle_id: circle.id };
    const invitation = ok(await op(a, 'create_invite', invitationInput));
    assert.match(invitation.invite.code, /^pc_[0-9a-f]{64}$/);
    assert.deepEqual(ok(await op(a, 'create_invite', invitationInput)), invitation);
    const stored = (await db.query('select token_hash from app_private.circle_invites where id=$1', [invitation.invite.id])).rows[0];
    assert.equal(stored.token_hash, createHash('sha256').update(invitation.invite.code).digest('hex'));
    const receiptText = JSON.stringify((await db.query('select * from app_private.operation_receipts where user_id=$1', [a.id])).rows);
    assert.equal(receiptText.includes(invitation.invite.code), false);
    assert.equal((await call(null, 'preview_invite', { code: invitation.invite.code })).status, 401);
    const preview = ok(await call(b, 'preview_invite', { code: invitation.invite.code }));
    assert.deepEqual(Object.keys(preview).sort(), ['expires_in_seconds', 'member_count', 'name', 'request_id', 'timezone']);
    assert.ok(preview.expires_in_seconds > 0 && preview.expires_in_seconds <= 604800);
    assert.equal((await join(stranger, invitation.invite.code)).data.code, 'PARTICIPATION_REQUIRED');
    const joinInput = { operation_id: randomUUID() }, joined = ok(await join(b, invitation.invite.code, joinInput));
    assert.deepEqual(ok(await join(b, invitation.invite.code, joinInput)), joined);
    const again = ok(await join(b, invitation.invite.code)); assert.equal(again.circle.member_id, joined.circle.member_id);
    assert.equal(ok(await call(b, 'list_circles')).items.length, 1);
    assert.equal((await manage(b, circle, 'delete')).status, 404);
    assert.equal((await manage(a, circle, 'leave')).data.code, 'OWNER_TRANSFER_REQUIRED');
    assert.equal((await call(b, 'list_circle_invites', { circle_id: circle.id })).status, 404);
    const invitations = ok(await call(a, 'list_circle_invites', { circle_id: circle.id }));
    assert.deepEqual(Object.keys(invitations.items[0]).sort(), ['expires_at', 'id']);
    const removeInput = { operation_id: randomUUID(), member_id: joined.circle.member_id };
    const removed = ok(await manage(a, circle, 'remove', removeInput));
    assert.equal((await call(b, 'read_circle_today', { circle_id: circle.id })).status, 404);
    assert.equal((await join(b, invitation.invite.code, joinInput)).data.code, 'MEMBERSHIP_CHANGED');
    const rejoined = ok(await join(b, invitation.invite.code)); assert.notEqual(rejoined.circle.member_id, joined.circle.member_id);
    assert.deepEqual(ok(await manage(a, circle, 'remove', removeInput)), removed);
    assert.equal(ok(await call(b, 'read_circle_today', { circle_id: circle.id })).circle.active_member_count, 2);
    assert.equal((await manage(a, circle, 'remove', { member_id: joined.circle.member_id })).status, 404);
    ok(await manage(a, circle, 'transfer', { member_id: rejoined.circle.member_id }));
    assert.equal((await call(a, 'preview_invite', { code: invitation.invite.code })).data.code, 'INVITE_UNAVAILABLE');
    assert.equal((await op(a, 'create_invite', invitationInput)).status, 404);
    ok(await manage(a, circle, 'leave'));
    const fresh = await invite(b, circle); ok(await manage(b, circle, 'revoke_invite', { invite_id: fresh.id }));
    assert.equal((await join(a, fresh.code)).data.code, 'INVITE_UNAVAILABLE');
    const expired = await invite(b, circle); await db.query("update app_private.circle_invites set expires_at=now()-interval '1 second' where id=$1", [expired.id]);
    assert.equal((await join(a, expired.code)).data.code, 'INVITE_UNAVAILABLE');
    await db.query("insert into app_private.reserved_circle_names(name_normalized) values('reserved test name') on conflict do nothing");
    assert.equal((await manage(b, circle, 'rename', { name: 'Reserved test name' })).data.code, 'INVALID_CIRCLE_NAME');
    await assert.rejects(db.query("update app_private.circles set timezone='Asia/Tokyo' where id=$1", [circle.id]), /immutable/);
    // A receipt write failure must roll back membership and circle creation together.
    await db.query("create function app_private.test_circle_receipt_failure() returns trigger language plpgsql as $$ begin if new.operation='create_circle' then raise exception 'receipt failure'; end if; return new; end $$; create trigger test_circle_receipt_failure before insert on app_private.operation_receipts for each row execute function app_private.test_circle_receipt_failure();");
    const failed = { operation_id: randomUUID(), name: 'Atomic circle', timezone: 'UTC', accept_circle_sharing: true };
    try {
      assert.equal((await op(a, 'create_circle', failed)).status, 503);
      assert.equal((await db.query('select 1 from app_private.circles where owner_id=$1 and name=$2', [a.id, failed.name])).rowCount, 0);
    } finally { await db.query('drop trigger test_circle_receipt_failure on app_private.operation_receipts; drop function app_private.test_circle_receipt_failure();'); }
    ok(await op(a, 'create_circle', failed));
    const deletion = { operation_id: randomUUID() }; const deleted = ok(await manage(b, circle, 'delete', deletion));
    assert.deepEqual(ok(await manage(b, circle, 'delete', deletion)), deleted);
    assert.equal((await call(b, 'read_circle_today', { circle_id: circle.id })).status, 404);
    for (let i = 0; i < 4; i++) await create(a, 'Quota circle ' + i);
    assert.equal((await op(a, 'create_circle', { name: 'Sixth circle', timezone: 'UTC', accept_circle_sharing: true })).data.code, 'CIRCLE_LIMIT');
  } finally { await f.cleanup(); }
});

test('real concurrent joins serialize the final member slot and a single user joining different circles', { timeout: 180000 }, async () => {
  const f = await fixture();
  try {
    const owner = await f.user(), left = await f.user(), right = await f.user(), circle = await f.create(owner), invitation = await f.invite(owner, circle);
    // Real accounts fill 18 other slots; only the two competing requests can consume the last slot.
    for (let i = 0; i < 18; i++) ok(await f.join(await f.user(), invitation.code));
    const raced = await Promise.all([f.join(left, invitation.code), f.join(right, invitation.code)]);
    assert.deepEqual(raced.map(r => r.status).sort(), [200, 409]); assert.equal(raced.find(r => r.status === 409).data.code, 'CIRCLE_FULL');
    assert.equal(ok(await f.call(owner, 'read_circle_today', { circle_id: circle.id })).circle.active_member_count, 20);
    const contender = await f.user(); for (let i = 0; i < 4; i++) await f.create(contender, 'Owned circle ' + i);
    const one = await f.create(left), two = await f.create(right), i1 = await f.invite(left, one), i2 = await f.invite(right, two);
    const quota = await Promise.all([f.join(contender, i1.code), f.join(contender, i2.code)]);
    assert.deepEqual(quota.map(r => r.status).sort(), [200, 409]); assert.equal(quota.find(r => r.status === 409).data.code, 'CIRCLE_LIMIT');
    assert.equal(ok(await f.call(contender, 'list_circles')).items.length, 5);
  } finally { await f.cleanup(); }
});

test('circle totals use fixed timezone, both membership intervals, authoritative records and filtered identities', { timeout: 120000 }, async () => {
  const f = await fixture(); const { db, op, call } = f;
  try {
    const a = await f.user(), b = await f.user(), zero = await f.user(), outsider = await f.user();
    for (const [u, alias] of [[a, 'zebra_test'], [b, 'Alpha_test'], [zero, 'middle_test']]) ok(await op(u, 'update_profile', { alias }));
    const circle = await f.create(a, 'Timezone circle', 'America/Los_Angeles'), invitation = await f.invite(a, circle);
    const joined = ok(await f.join(b, invitation.code)); ok(await f.join(zero, invitation.code));
    const anchor = '2026-03-09T06:59:59.999Z', midnight = '2026-03-08T08:00:00.000Z'; // LA spring-forward day is 23 hours.
    await db.query("update app_private.circle_memberships set joined_at='2026-03-01T00:00:00Z' where circle_id=$1", [circle.id]);
    const seed = async (user, quantity, occurred, { created = occurred, source = 'native', deleted = false, excluded = false } = {}) => {
      const id = randomUUID();
      await db.query("insert into app_private.checkins(id,user_id,quantity,occurred_at,created_at,recorded_timezone,local_date,source,version,revision,deleted_at,moderation_excluded) values($1,$2,$3,$4,$5,'Asia/Tokyo',($4::timestamptz at time zone 'Asia/Tokyo')::date,$6,1,1,case when $7 then $5::timestamptz else null end,$8)", [id, user.id, quantity, occurred, created, source, deleted, excluded]); return id;
    };
    await seed(a, 100, midnight); await seed(b, 85, '2026-03-09T06:00:00Z');
    await seed(a, 900, '2026-03-08T07:59:59.999Z'); await seed(a, 800, '2026-03-09T07:00:00Z');
    await seed(a, 700, midnight, { source: 'import' }); await seed(a, 600, midnight, { deleted: true }); await seed(a, 500, midnight, { excluded: true });
    const today = async (viewer = a, at = anchor) => (await db.query('select app_private.circle_today($1,$2,$3) value', [circle.id, viewer.id, at])).rows[0].value;
    let result = await today(); assert.equal(result.local_date, '2026-03-08'); assert.equal(result.total_reps, '185'); assert.equal(result.checked_in_count, 2); assert.equal(result.active_member_count, 3);
    assert.deepEqual(result.members.map(m => m.username), ['Alpha_test', 'middle_test', 'zebra_test']); assert.equal(result.members[1].total_reps, '0');
    for (const member of result.members) assert.deepEqual(Object.keys(member).sort(), ['checked_in', 'is_self', 'member_id', 'total_reps', 'username']);
    for (const user of [a, b, zero]) assert.equal(JSON.stringify(result).includes(user.id), false);
    assert.equal(await today(outsider), null); assert.equal((await today(a, '2026-03-09T07:00:00Z')).local_date, '2026-03-09');
    // Backdated events accepted after joining, and older accepted events whose event time is newer, both remain excluded.
    await db.query("update app_private.circle_memberships set joined_at='2026-03-09T05:00:00Z' where circle_id=$1 and user_id=$2", [circle.id, b.id]);
    await seed(b, 400, '2026-03-09T04:59:59Z', { created: '2026-03-09T06:00:00Z' });
    await seed(b, 300, '2026-03-09T06:00:00Z', { created: '2026-03-09T04:59:59Z' });
    assert.equal((await today()).total_reps, '185'); assert.equal((await today(b)).total_reps, '85');
    const report = ok(await op(a, 'report_subject', { subject_type: 'alias', subject_id: joined.circle.member_id, reason: 'other' }));
    assert.match((await db.query('select subject_id from app_private.reports where id=$1', [report.report_id])).rows[0].subject_id, /^a_/);
    assert.equal((await op(outsider, 'block_user', { actor_id: joined.circle.member_id })).status, 404);
    const block = ok(await op(a, 'block_user', { actor_id: joined.circle.member_id })); assert.equal(block.actor_id, joined.circle.member_id);
    result = await today(); assert.equal(result.total_reps, '100'); assert.equal(result.active_member_count, 3); assert.equal(result.members.length, 2); assert.equal(result.hidden_activity, true);
    assert.equal((await today(b)).members.some(m => m.is_self === false && m.username === 'zebra_test'), false);
    const blockedActor = ok(await call(a, 'list_blocks')).items[0].actor_id; ok(await op(a, 'unblock_user', { actor_id: blockedActor }));
    await db.query("update app_private.profiles set account_status='suspended' where user_id=$1", [b.id]);
    assert.equal((await today()).total_reps, '100'); assert.equal((await call(b, 'read_circle_today', { circle_id: circle.id })).status, 403);
    await db.query("update app_private.profiles set account_status='active' where user_id=$1", [b.id]);
    await db.query("update app_private.circle_memberships set joined_at='2026-03-09T06:30:00Z' where circle_id=$1 and user_id=$2", [circle.id, b.id]);
    assert.equal((await today()).total_reps, '100'); assert.equal((await today(b)).total_reps, '0');
    const tokyo = await f.create(a, 'Tokyo circle', 'Asia/Tokyo');
    await db.query("update app_private.circle_memberships set joined_at='2026-03-01T00:00:00Z' where circle_id=$1", [tokyo.id]);
    const tokyoDate = async at => (await db.query('select app_private.circle_today($1,$2,$3) value', [tokyo.id, a.id, at])).rows[0].value.local_date;
    assert.equal(await tokyoDate('2026-03-08T14:59:59Z'), '2026-03-08'); assert.equal(await tokyoDate('2026-03-08T15:00:00Z'), '2026-03-09');
  } finally { await f.cleanup(); }
});
