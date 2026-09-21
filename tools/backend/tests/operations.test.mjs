import { test } from 'node:test';
import assert from 'node:assert/strict';
import { operationsMetrics } from '../scripts/operations-metrics.mjs';
import { localEnvironment } from './environment.mjs';
test('operations diagnostics expose only four nonnegative aggregate values', async () => {
  const metrics = await operationsMetrics(localEnvironment().db);
  assert.deepEqual(Object.keys(metrics).sort(), ['failed_deletions','oldest_deletion_seconds','open_reports','pending_deletions']);
  for (const value of Object.values(metrics)) assert.ok(Number.isInteger(value) && value >= 0);
});
