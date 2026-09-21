import { runDeletionWorker } from './deletion-worker.mjs';
import { operationsMetrics } from './operations-metrics.mjs';
import { healthFailures, validateHostedOperations } from './operations-health.mjs';

// Render serializes runs. Termination is safe: committed phases and proofs survive retries.
const deadline = setTimeout(() => { console.error('OPERATIONS_DEADLINE_EXCEEDED'); process.exit(1); }, 55000);
try {
  validateHostedOperations(process.env);
  const counts = await runDeletionWorker({ dbUrl: process.env.DELETION_DATABASE_URL, apiUrl: process.env.DELETION_API_URL, adminKey: process.env.DELETION_ADMIN_KEY, steps: 25 });
  const metrics = await operationsMetrics(process.env.DELETION_DATABASE_URL);
  const failures = healthFailures(metrics);
  if (counts.failed && !failures.includes('DELETION_FAILED')) failures.push('DELETION_FAILED');
  console.log(JSON.stringify({ counts, metrics, failures }));
  if (failures.length) process.exitCode = 1;
  else if (process.env.OPERATIONS_HEARTBEAT_URL) {
    const response = await fetch(process.env.OPERATIONS_HEARTBEAT_URL, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error('HEARTBEAT_FAILED');
  }
} catch { console.error('OPERATIONS_CYCLE_FAILED'); process.exitCode = 1; }
finally { clearTimeout(deadline); }
