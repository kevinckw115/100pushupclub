import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ChunkStore } from '../src/data/auth/chunk-store.ts';

function fixture() {
  const data = new Map<string, string>();
  let fault = -1, writes = 0;
  const adapter = {
    getItem: async (key: string) => data.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      assert.ok(Buffer.byteLength(value) <= 1500);
      if (++writes === fault) throw new Error('injected storage failure');
      data.set(key, value);
    },
    removeItem: async (key: string) => { data.delete(key); },
  };
  return { data, adapter, store: new ChunkStore(adapter), fail: (n: number) => { writes = 0; fault = n; } };
}
const key = 'pushupclub.auth';
test('large Unicode sessions rotate without truncation and clean old chunks', async () => {
  const f = fixture(), original = 'refresh-token-🧱'.repeat(1000);
  await f.store.setItem(key, original);
  assert.equal(await new ChunkStore(f.adapter).getItem(key), original);
  await f.store.setItem(key, 'rotated');
  assert.equal(await f.store.getItem(key), 'rotated');
  assert.equal([...f.data.keys()].some(key => key.startsWith('pushupclub.auth.0.')), false);
  await f.store.clear(); assert.equal(f.data.size, 0);
});
test('failure at every write before manifest commit preserves the previous complete session', async () => {
  const next = 'a'.repeat(4000);
  // journal + three chunks + manifest
  for (let failure = 1; failure <= 5; failure++) {
    const f = fixture(); await f.store.setItem(key, 'previous'); f.fail(failure);
    await assert.rejects(f.store.setItem(key, next), /injected/);
    assert.equal(await new ChunkStore(f.adapter).getItem(key), 'previous');
    assert.equal([...f.data.keys()].some(key => key.startsWith('pushupclub.auth.1.')), false);
  }
});
test('fresh-install reset clears residual and abandoned Keychain slots; missing chunks fail closed', async () => {
  const f = fixture(); await f.store.setItem(key, 'a'.repeat(4000));
  f.data.delete(key + '.0.1');
  await assert.rejects(f.store.getItem(key), /recovery/);
  await new ChunkStore(f.adapter).clear(); assert.equal(f.data.size, 0);
  assert.equal(await f.store.getItem(key), null);
});
test('concurrent rotation/removal is ordered and oversized tokens fail without destroying the old session', async () => {
  const f = fixture(); await f.store.setItem(key, 'old');
  await assert.rejects(f.store.setItem(key, 'a'.repeat(100000)), /too large/);
  assert.equal(await f.store.getItem(key), 'old');
  await Promise.all([f.store.setItem(key, 'one'), f.store.setItem(key, 'two'), f.store.removeItem(key)]);
  assert.equal(await f.store.getItem(key), null); assert.equal(f.data.size, 0);
});
