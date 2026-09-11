import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { account, localEnvironment, removeAccount, request } from './environment.mjs';

test('100k records and 100 foreground clients return bounded accurate sanitized Club responses', { timeout: 180000 }, async () => {
  const config = localEnvironment(), users = [], db = new pg.Client({ connectionString: config.db }); await db.connect();
  try {
    await db.query("set statement_timeout='90s'");
    for (let i = 0; i < 10; i++) {
      const user = await account(config); users.push(user);
      assert.equal((await request(config, '/rest/v1/rpc/bootstrap_profile', { token: user.token, body: { operation_id: randomUUID() } })).status, 200);
      assert.equal((await request(config, '/rest/v1/rpc/update_profile', { token: user.token, body: { envelope: { operation_id: randomUUID(), public_enabled: true, expected_consent_epoch: '0', accepted_terms_version: 'community-v1-2026-09-11' } } })).status, 200);
    }
    const invalid = (zone, day) => db.query("insert into app_private.checkins(id,user_id,quantity,occurred_at,recorded_timezone,local_date,source,version,revision) values(gen_random_uuid(),$1,1,'2026-09-11T12:00:00Z',$2,$3,'native',1,1)", [users[0].id, zone, day]);
    await assert.rejects(invalid('Not/A_Zone','2026-09-11'), error => error.code === '22023' && error.message === 'INVALID_TIMEZONE');
    await assert.rejects(invalid('UTC','2026-09-10'), error => error.code === '22023' && error.message === 'INVALID_LOCAL_DATE');
    // Ten days, ten contributors, exactly 10k eligible in the rolling 24-hour window.
    await db.query(`insert into app_private.checkins(id,user_id,quantity,occurred_at,recorded_timezone,local_date,source,created_at,version,revision,public_epoch)
      select gen_random_uuid(),($1::uuid[])[((n-1)/10)%10+1],1,t,'UTC',(t at time zone 'UTC')::date,'native',t,1,n,1
      from generate_series(1,100000) n cross join lateral
      (select now()-((n-1)%10)*interval '1 day'-(n%600+60)*interval '1 second' as t) times`, [users.map(u => u.id)]);
    await db.query('analyze app_private.checkins');
    const durations = [], started = performance.now();
    await Promise.all(Array.from({ length: 100 }, async (_, i) => {
      // One foreground poll per client, distributed across the normal 30-second interval.
      await new Promise(resolve => setTimeout(resolve, i * 300));
      const start = performance.now(), response = await request(config, '/rest/v1/rpc/read_club', { token: users[i % 10].token, body: { scope_id: 'world', cursor: null, limit: 25 } });
      durations.push(performance.now() - start); assert.equal(response.status, 200);
      assert.equal(response.data.pushups_past_24_hours, '10000'); assert.equal(response.data.people_past_hour, 10);
      assert.equal(response.data.items.length, 25);
      assert.doesNotMatch(JSON.stringify(response.data), /"(?:user_id|email|occurred_at|recorded_timezone|local_date)"/);
    }));
    durations.sort((a,b) => a-b);
    console.log(JSON.stringify({ benchmark: 'disposable-ci-postgres-http', records: 100000, foreground_clients: 100, interval_seconds: 30, requests: durations.length, p50_ms: Math.round(durations[49]), p95_ms: Math.round(durations[94]), max_ms: Math.round(durations[99]), elapsed_ms: Math.round(performance.now()-started), deployment_region_verified: false }));
  } finally { await db.end(); for (const user of users) await removeAccount(config, user); }
});
