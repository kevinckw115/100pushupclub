import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { openTestDatabase } from '../../src/testing/node-sqlite.ts';
import { migrate } from '../../src/data/local/migrations.ts';
import { LocalRepository } from '../../src/data/local/repository.ts';
import { RegionDirectory, world } from '../../src/data/regions.ts';

test('directory cache preserves only validated public fields and works offline', async () => {
  const db = openTestDatabase(':memory:'); migrate(db);
  const local = new LocalRepository(db, randomUUID);
  let mode = 'valid';
  const server = createServer((_req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (mode === 'offline') { res.writeHead(503); res.end('{}'); }
    else res.end(JSON.stringify({ version: 'test', items: [{ ...world, id: mode === 'invalid' ? 'bad' : 'gn:123', parent_id: 'world', kind: 'country', name: 'Public name', label: 'Public name', extra: 'not cached' }], next_cursor: null, unexpected: 'not cached' }));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const directory = new RegionDirectory(local, `http://127.0.0.1:${address.port}`, 'public-test-key');
  const signal = () => new AbortController().signal;
  try {
    const loaded = await directory.list('world', '', null, signal()); assert.equal(loaded.cached, false);
    assert.equal(JSON.stringify(db.all('SELECT payload FROM cached_queries')).includes('not cached'), false);
    mode = 'offline'; const cached = await directory.list('world', '', null, signal()); assert.equal(cached.cached, true); assert.equal(cached.items[0].name, 'Public name');
    mode = 'invalid'; await assert.rejects(directory.list(null, 'bad', null, signal()), /Invalid/);
    assert.equal(db.all('SELECT * FROM cached_queries').length, 1);
    mode = 'valid'; for (let index = 0; index < 25; index++) await directory.list(null, 'term' + index, null, signal());
    assert.equal(db.all('SELECT * FROM cached_queries').length, 20);
    const controller = new AbortController(); controller.abort();
    await assert.rejects(directory.list('world', '', null, controller.signal), /Cancelled/);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); db.close(); }
});
