import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { HttpSyncTransport } from '../../src/data/sync/transport.ts';
import { SyncFailure } from '../../src/data/sync/protocol.ts';

test('HTTP worker refreshes once, respects rate delay and fences token lookup after logout', async () => {
  let calls = 0, mode = 'refresh';
  const server = createServer((req, res) => {
    calls++;
    if (mode === 'rate') { res.writeHead(429, { 'Retry-After': '30' }); res.end(JSON.stringify({ code: 'RATE_LIMITED' })); }
    else if (mode === 'reject' || req.headers.authorization === 'Bearer expired') { res.writeHead(401); res.end('{}'); }
    else { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ request_id: randomUUID(), changes: [], next_revision: '0', has_more: false })); }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const refreshes: boolean[] = [];
  let valid = true;
  const transport = new HttpSyncTransport(`http://127.0.0.1:${address.port}`, 'local-fixture', { userId: randomUUID(), valid: () => valid, token: async refresh => { refreshes.push(refresh); return refresh ? 'renewed' : 'expired'; } });
  try {
    assert.equal((await transport.pull('0', new AbortController().signal)).next_revision, '0');
    assert.deepEqual(refreshes, [false, true]); assert.equal(calls, 2);
    mode = 'reject';
    await assert.rejects(transport.pull('0', new AbortController().signal), (error: unknown) => error instanceof SyncFailure && error.code === 'UNAUTHENTICATED');
    assert.equal(calls, 4);
    mode = 'rate';
    await assert.rejects(transport.pull('0', new AbortController().signal), (error: unknown) => error instanceof SyncFailure && error.retryable && error.retryAfterMs === 30000);
    let release!: (value: string) => void;
    const pending = new HttpSyncTransport(transport.url, 'local-fixture', { userId: randomUUID(), valid: () => valid, token: () => new Promise(resolve => { release = resolve; }) }).pull('0', new AbortController().signal);
    valid = false; release('late-token');
    await assert.rejects(pending, (error: unknown) => error instanceof SyncFailure && error.code === 'STALE_SCOPE');
    assert.equal(calls, 5);
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});
