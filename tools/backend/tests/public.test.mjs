import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { account, localEnvironment, removeAccount, request } from './environment.mjs';

const create = (epoch, quantity = 10, time = new Date(Date.now() - 60000).toISOString(), extra = {}) => ({ kind: 'create', mutation_id: randomUUID(), checkin_id: randomUUID(), quantity, occurred_at: time, recorded_timezone: 'UTC', local_date: time.slice(0, 10), source: 'native', requested_public_epoch: epoch, ...extra });
async function fixture(run) {
  const config = localEnvironment(), users = [], db = new pg.Client({ connectionString: config.db }); await db.connect();
  const fresh = async () => { const user = await account(config); users.push(user); assert.equal((await request(config, '/rest/v1/rpc/bootstrap_profile', { token: user.token, body: { operation_id: randomUUID() } })).status, 200); return user; };
  const profile = (user, fields) => request(config, '/rest/v1/rpc/update_profile', { token: user?.token, body: { envelope: { operation_id: randomUUID(), ...(fields.public_enabled === true ? { accepted_terms_version: 'community-v1-2026-09-11' } : {}), ...fields } } });
  const mutate = (user, envelope) => request(config, '/rest/v1/rpc/mutate_checkin', { token: user.token, body: { envelope } });
  const club = (scope_id = 'world', cursor = null, limit = 50, user = null) => request(config, '/rest/v1/rpc/read_club', { token: user?.token, body: { scope_id, cursor, limit } });
  const ids = Object.fromEntries((await db.query("SELECT source_code,id FROM app_private.regions WHERE source_code IN ('US.CA','US.CA.059','US.CA.037')")).rows.map(r => [r.source_code, r.id]));
  try { await run({ config, db, users, fresh, profile, mutate, club, ids }); }
  finally { await db.end(); for (const user of users) await removeAccount(config, user); }
}

test('profile receipts, consent epochs, aliases and concurrent creates preserve privacy', { timeout: 90000 }, async () => fixture(async ({ db, fresh, profile, mutate, club, ids }) => {
  const a = await fresh(), b = await fresh(), alias = 'a_' + randomUUID().replaceAll('-', '').slice(0, 14), operation = randomUUID();
  const input = { operation_id: operation, alias: ' ' + alias + ' ', region_id: ids['US.CA.059'], public_enabled: true, expected_consent_epoch: '0' };
  const enabled = await profile(a, input); assert.equal(enabled.status, 200, JSON.stringify(enabled.data)); assert.equal(enabled.data.profile.consent_epoch, '1');
  assert.deepEqual((await profile(a, { ...input, alias })).data, enabled.data);
  assert.equal((await profile(a, { ...input, alias: alias + 'x' })).data.code, 'IDEMPOTENCY_KEY_REUSED');
  assert.equal((await profile(b, { alias: alias.toUpperCase() })).data.code, 'ALIAS_UNAVAILABLE');
  assert.equal((await profile(a, { alias: 'admin' })).data.code, 'ALIAS_UNAVAILABLE');
  assert.equal((await profile(a, { public_enabled: false, expected_consent_epoch: 'bad' })).status, 400);
  assert.equal((await profile(a, { user_id: b.id, alias: 'forged' })).status, 400);
  assert.ok((await profile(null, { alias: 'guest' })).status >= 400);
  const one = await mutate(a, create('1', 20)); assert.equal(one.data.effective_public, true);
  assert.equal((await club()).data.pushups_past_24_hours, '20');
  const off = await profile(a, { public_enabled: false, expected_consent_epoch: '1' }); assert.equal(off.data.profile.consent_epoch, '2');
  assert.equal((await club()).data.pushups_past_24_hours, '0');
  assert.equal((await profile(a, { public_enabled: true, expected_consent_epoch: '2' })).data.profile.consent_epoch, '3');
  assert.equal((await mutate(a, create('1', 99))).data.effective_public, false);
  assert.equal((await mutate(a, create('3', 22))).data.effective_public, true);
  assert.equal((await club()).data.pushups_past_24_hours, '22');
  assert.equal((await profile(a, { region_id: ids['US.CA.037'], expected_consent_epoch: '3' })).data.profile.consent_epoch, '4');
  assert.equal((await club()).data.pushups_past_24_hours, '0');
  const race = await Promise.all([profile(a, { public_enabled: false, expected_consent_epoch: '4' }), mutate(a, create('4', 13))]);
  assert.equal(race[0].status, 200); assert.equal(race[1].status, 200); assert.equal((await club()).data.pushups_past_24_hours, '0');
  const competing = await Promise.all([profile(a, { public_enabled: true, expected_consent_epoch: '5' }), profile(a, { region_id: ids['US.CA.059'], expected_consent_epoch: '5' })]);
  assert.equal(competing.filter(r => r.status === 200).length, 1); assert.equal(competing.filter(r => r.data.code === 'CONSENT_CONFLICT').length, 1);
  const before = (await db.query('SELECT alias,consent_epoch::text FROM app_private.profiles WHERE user_id=$1', [a.id])).rows[0];
  await db.query("CREATE FUNCTION app_private.test_profile_receipt_failure() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$ BEGIN RAISE EXCEPTION 'TEST_RECEIPT_FAILURE'; END $$; CREATE TRIGGER test_profile_receipt_failure BEFORE INSERT ON app_private.operation_receipts FOR EACH ROW EXECUTE FUNCTION app_private.test_profile_receipt_failure();");
  try {
    const failed = await profile(a, { alias: 'rollback_' + randomUUID().slice(0, 8) }); assert.equal(failed.status, 503); assert.equal(failed.data.code, 'SERVER_RETRY');
    assert.equal(JSON.stringify(failed.data).includes('TEST_RECEIPT_FAILURE'), false);
    assert.deepEqual((await db.query('SELECT alias,consent_epoch::text FROM app_private.profiles WHERE user_id=$1', [a.id])).rows[0], before);
  } finally { await db.query('DROP TRIGGER test_profile_receipt_failure ON app_private.operation_receipts; DROP FUNCTION app_private.test_profile_receipt_failure();'); }
}));

test('public thresholds, current totals, ciphertext cursors and all exclusions use one predicate', { timeout: 120000 }, async () => fixture(async ({ config, db, fresh, profile, mutate, club, ids }) => {
  const members = [], inputs = [];
  for (let i = 0; i < 11; i++) {
    const user = await fresh(); members.push(user);
    assert.equal((await profile(user, { public_enabled: true, region_id: ids[i === 10 ? 'US.CA.037' : 'US.CA.059'], expected_consent_epoch: '0' })).status, 200);
    if (i < 9) { const input = create('1'); inputs.push(input); assert.equal((await mutate(user, input)).status, 200); }
  }
  const nine = await club(ids['US.CA.059']); assert.equal(nine.status, 200, JSON.stringify(nine.data)); assert.equal(nine.data.effective_scope.id, 'world'); assert.equal(nine.data.pushups_past_24_hours, '90');
  const extra = create('1', 5); await mutate(members[0], extra);
  assert.equal((await club(ids['US.CA.059'])).data.effective_scope.id, 'world');
  const tenth = create('1'); inputs.push(tenth); await mutate(members[9], tenth);
  const ten = await club(ids['US.CA.059']); assert.equal(ten.data.effective_scope.id, ids['US.CA.059']); assert.equal(ten.data.people_past_hour, 10); assert.equal(ten.data.pushups_past_24_hours, '105');
  const first = await club('world', null, 3); assert.ok(first.data.next_cursor);
  const firstIds = new Set(first.data.items.map(r => r.id));
  const second = await club('world', first.data.next_cursor, 3); assert.equal(second.status, 200); assert.equal(second.data.items.some(r => firstIds.has(r.id)), false);
  for (const row of first.data.items) assert.deepEqual(Object.keys(row).sort(), ['actor_id', 'id', 'quantity', 'relative_time', 'username']);
  const serialized = JSON.stringify({ ...first.data, window: undefined });
  for (const user of members) assert.equal(serialized.includes(user.id), false);
  for (const input of inputs) { assert.equal(serialized.includes(input.checkin_id), false); assert.equal(serialized.includes(input.occurred_at), false); }
  const decoded = Buffer.from(first.data.next_cursor, 'base64'); assert.equal(decoded.toString().includes('before_time'), false);
  assert.equal((await club(ids['US.CA.059'], first.data.next_cursor)).status, 400);
  assert.equal((await club('world', first.data.next_cursor, 3, members[0])).status, 400);
  decoded[Math.floor(decoded.length / 2)] ^= 1; assert.equal((await club('world', decoded.toString('base64'))).status, 400);
  const expired = (await db.query("SELECT replace(encode(extensions.pgp_sym_encrypt(jsonb_set(extensions.pgp_sym_decrypt(decode($1,'base64'),s.value)::jsonb,'{anchor}',to_jsonb((now()-interval '16 minutes')::text))::text,s.value,'cipher-algo=aes256'),'base64'),E'\\n','') value FROM app_private.server_secrets s WHERE name='feed_cursor_v1'", [first.data.next_cursor])).rows[0].value;
  assert.equal((await club('world', expired)).status, 400);
  const response = await fetch(config.api + '/rest/v1/rpc/read_club', { method: 'POST', headers: { apikey: config.key, 'Content-Type': 'application/json' }, body: '{}' }); assert.equal(response.headers.get('cache-control'), 'no-store');
  await db.query('INSERT INTO app_private.blocks(blocker_id,blocked_id) VALUES($1,$2)', [members[0].id, members[1].id]);
  const blocked = await club(ids['US.CA.059'], null, 50, members[0]); assert.equal(blocked.data.effective_scope.id, ids['US.CA.059']); assert.equal(blocked.data.people_past_hour, 9); assert.equal(blocked.data.pushups_past_24_hours, '95');
  assert.equal((await club(ids['US.CA.059'], null, 50, members[1])).data.pushups_past_24_hours, '90');
  await db.query('DELETE FROM app_private.blocks WHERE blocker_id=$1', [members[0].id]);
  const outside = create('1', 31); await mutate(members[10], outside);
  const edit = await mutate(members[0], { kind: 'update', mutation_id: randomUUID(), checkin_id: inputs[0].checkin_id, quantity: 30, expected_version: 1 }); assert.equal(edit.status, 200);
  assert.equal((await club(ids['US.CA.059'])).data.pushups_past_24_hours, '125');
  await mutate(members[0], { kind: 'delete', mutation_id: randomUUID(), checkin_id: extra.checkin_id, expected_version: 1 });
  await mutate(members[0], { kind: 'delete', mutation_id: randomUUID(), checkin_id: inputs[0].checkin_id, expected_version: 2 });
  const state = await club(ids['US.CA.059']); assert.equal(state.data.effective_scope.id, ids['US.CA']); assert.equal(state.data.pushups_past_24_hours, '121');
  await mutate(members[0], create(null, 100, undefined, { source: 'import' }));
  await mutate(members[0], create('0', 99));
  const old = new Date(Date.now() - 25 * 3600000).toISOString(); await mutate(members[0], create('1', 50, old));
  assert.equal((await club()).data.pushups_past_24_hours, '121');
  await db.query('UPDATE app_private.checkins SET moderation_excluded=true WHERE id=$1', [outside.checkin_id]);
  assert.equal((await club()).data.pushups_past_24_hours, '90');
  await db.query("UPDATE app_private.profiles SET account_status='suspended' WHERE user_id=$1", [members[1].id]);
  assert.equal((await club()).data.pushups_past_24_hours, '80');
  assert.equal((await club('world', null, 50, members[1])).status, 403);
  await profile(members[2], { public_enabled: false, expected_consent_epoch: '1' });
  assert.equal((await club()).data.pushups_past_24_hours, '70');
  await db.query("INSERT INTO app_private.deletion_jobs(user_id,status) VALUES($1,'pending')", [members[3].id]);
  assert.equal((await club()).data.pushups_past_24_hours, '60');
}));

test('a late committing public create is excluded from older pages but appears on refresh', { timeout: 90000 }, async () => fixture(async ({ config, db, fresh, profile, mutate, club }) => {
  const user = await fresh(); await profile(user, { public_enabled: true, expected_consent_epoch: '0' });
  for (let n = 0; n < 4; n++) assert.equal((await mutate(user, create('1', 10))).status, 200);
  const transaction = new pg.Client({ connectionString: config.db }); await transaction.connect();
  const delayed = create('1', 17, new Date(Date.now() - 3600000).toISOString());
  try {
    await transaction.query('BEGIN'); await transaction.query('SET LOCAL ROLE authenticated');
    await transaction.query("SELECT set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: user.id, role: 'authenticated' })]);
    const held = await transaction.query('SELECT public.mutate_checkin($1::jsonb) result', [JSON.stringify(delayed)]); assert.equal(held.rows[0].result.record.quantity, 17);
    const initial = await club('world', null, 1); assert.equal(initial.data.pushups_past_24_hours, '40'); assert.ok(initial.data.next_cursor);
    await transaction.query('COMMIT');
    const later = await club('world', initial.data.next_cursor, 50); assert.equal(later.status, 200); assert.equal(later.data.pushups_past_24_hours, '40'); assert.equal(later.data.items.length, 3);
    assert.equal((await club()).data.pushups_past_24_hours, '57');
    const publicId = (await db.query('SELECT public_entry_id FROM app_private.checkins WHERE id=$1', [delayed.checkin_id])).rows[0].public_entry_id;
    assert.equal(later.data.items.some(r => r.id === publicId), false);
  } finally { await transaction.query('ROLLBACK'); await transaction.end(); }
}));
