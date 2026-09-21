import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { prepareRecovery, readRecovery, storageKey, validateStatus } from '../apps/site/client.mjs';
const storage = () => { const data = new Map(); return { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) }; };
test('deletion recovery survives reload and retries without changing operation or proof', () => {
  const s = storage(), id = randomUUID(), first = prepareRecovery(s, id);
  assert.deepEqual(readRecovery(s), first); assert.deepEqual(prepareRecovery(s, id), first);
  assert.throws(() => prepareRecovery(s, randomUUID()), /ORIGINAL_ACCOUNT_REQUIRED/);
  assert.equal(first.envelope.status_token.length, 66);
});
test('blocked storage and corrupt recovery fail closed instead of replacing an in-flight proof', () => {
  const s = storage(); s.setItem(storageKey, '{'); assert.throws(() => prepareRecovery(s, randomUUID()));
  assert.throws(() => prepareRecovery({ getItem: () => null, setItem: () => {} }, randomUUID()), /RECOVERY_UNAVAILABLE/);
  assert.throws(() => prepareRecovery({ getItem: () => null, setItem: () => { throw new Error('quota'); } }, randomUUID()), /quota/);
});
test('malformed status cannot be displayed as successful cleanup', () => {
  assert.throws(() => validateStatus({ status: 'complete' }));
  assert.equal(validateStatus({ status: 'complete', job_id: randomUUID(), request_id: randomUUID(), completion_target_days: 7 }).status, 'complete');
});
