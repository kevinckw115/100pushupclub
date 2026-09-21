import { test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { localEnvironment, request, account, removeAccount } from './environment.mjs';
test('real directory RPCs bound public search, bind cursors and resolve ancestor fallbacks', async () => {
  const config = localEnvironment(), user = await account(config);
  const db = new pg.Client({ connectionString: config.db }); await db.connect();
  const list = body => request(config, '/rest/v1/rpc/list_regions', { body });
  const resolve = id => request(config, '/rest/v1/rpc/resolve_region', { body: { region_id: id } });
  try {
    const count = await db.query('SELECT COUNT(*)::integer count FROM app_private.regions'); assert.equal(count.rows[0].count, 7259);
    const first = await list({ parent_id: 'world', limit: 17 });
    assert.equal(first.status, 200); assert.equal(first.data.items.length, 17); assert.ok(first.data.next_cursor);
    const second = await list({ parent_id: 'world', limit: 17, cursor: first.data.next_cursor });
    assert.equal(second.status, 200);
    assert.equal(new Set([...first.data.items, ...second.data.items].map(r => r.id)).size, 34);
    assert.deepEqual(Object.keys(first.data.items[0]).sort(), ['has_children', 'id', 'kind', 'label', 'name', 'parent_id']);
    assert.equal((await list({ parent_id: null, search: 'orange', cursor: first.data.next_cursor })).status, 400);
    for (const body of [{ limit: 51 }, { limit: 0 }, { search: 'x' }, { search: 'x'.repeat(81) }, { cursor: 'garbage' }, { parent_id: 'missing' }]) assert.equal((await list(body)).status, 400);
    const matches = await list({ parent_id: null, search: 'ORANGE COUNTY' }); assert.equal(matches.status, 200);
    const orange = matches.data.items.find(r => r.label.includes('California'));
    assert.ok(orange); assert.equal(orange.kind, 'locality');
    const resolved = await resolve(orange.id); assert.equal(resolved.status, 200);
    assert.deepEqual(resolved.data.ancestors.map(r => r.kind), ['world', 'country', 'admin1', 'locality']);
    const california = resolved.data.ancestors[2];
    assert.equal(resolved.data.region.parent_id, california.id);
    assert.equal((await request(config, '/rest/v1/rpc/list_regions', { token: user.token, body: { parent_id: california.id } })).status, 200);
    const accent = await list({ parent_id: null, search: 'sao paulo' });
    assert.ok(accent.data.items.some(r => r.kind === 'admin1' && r.name === 'São Paulo'));
    const wildcard = await list({ parent_id: null, search: "%' OR 1=1 --" }); assert.equal(wildcard.status, 200); assert.equal(wildcard.data.items.length, 0);
    assert.equal((await resolve('unknown-retired-region')).data.region.id, 'world');
    await db.query('UPDATE app_private.regions SET active=false WHERE id=$1', [orange.id]);
    const fallback = await resolve(orange.id); assert.equal(fallback.data.region.id, california.id); assert.equal(fallback.data.fallback_reason, 'MISSING_REGION');
    await db.query('UPDATE app_private.regions SET active=true WHERE id=$1', [orange.id]);
    const grants = await db.query("SELECT p.prosecdef,p.proconfig FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('list_regions','resolve_region')");
    assert.equal(grants.rows.length, 2); for (const fn of grants.rows) { assert.equal(fn.prosecdef, true); assert.ok(fn.proconfig.some(value => /^search_path=(""|)$/.test(value))); }
    assert.equal((await db.query("SELECT COUNT(*)::integer count FROM app_private.regions WHERE kind='locality' AND country_code<>'US'")).rows[0].count, 0);
  } finally { await db.end(); await removeAccount(config, user); }
});
