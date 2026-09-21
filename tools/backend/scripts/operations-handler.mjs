import pg from 'pg';
import { runDeletionWorker } from './deletion-worker.mjs';
import { operationsMetrics } from './operations-metrics.mjs';
import { validateHostedOperations, healthFailures } from './operations-health.mjs';

const reply = (code, status) => Response.json({ code }, { status, headers: { 'Cache-Control': 'no-store' } });
async function equalSecret(a, b) {
  const digest = async value => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
  const [x,y] = await Promise.all([digest(a), digest(b)]);
  let difference = 0; for (let i = 0; i < x.length; i++) difference |= x[i] ^ y[i];
  return difference === 0;
}
function validate(env) {
  // The disposable integration suite can only target loopback databases and APIs.
  if (env.OPERATIONS_LOCAL_TEST === '1' &&
      ['127.0.0.1','localhost'].includes(new URL(env.DELETION_API_URL).hostname) &&
      ['127.0.0.1','localhost'].includes(new URL(env.DELETION_DATABASE_URL).hostname)) return;
  validateHostedOperations(env);
}
export function operationsHandler(env) {
  return async request => {
    if (request.method !== 'POST') return reply('METHOD_NOT_ALLOWED', 405);
    const secret = env.OPERATIONS_CRON_SECRET;
    if (!/^[a-f0-9]{64}$/.test(secret ?? '')) return reply('OPERATIONS_UNCONFIGURED', 503);
    const presented = request.headers.get('x-operations-key') ?? '';
    if (presented.length !== 64 || !await equalSecret(presented, secret)) return reply('UNAUTHORIZED', 401);
    let lock;
    try {
      validate(env);
      lock = new pg.Client({ connectionString: env.DELETION_DATABASE_URL, connectionTimeoutMillis: 5000, query_timeout: 5000 });
      await lock.connect();
      // Session-level lock prevents overlapping invocations; use the session pooler.
      const acquired = (await lock.query('select pg_try_advisory_lock(100, 2201) acquired')).rows[0].acquired;
      if (!acquired) return reply('ALREADY_RUNNING', 409);
      const counts = await runDeletionWorker({ dbUrl: env.DELETION_DATABASE_URL, apiUrl: env.DELETION_API_URL, adminKey: env.DELETION_ADMIN_KEY });
      const metrics = await operationsMetrics(env.DELETION_DATABASE_URL);
      const failures = healthFailures(metrics);
      console.log(JSON.stringify({ counts, metrics, failures }));
      if (counts.failed || failures.length) return reply('OPERATIONS_UNHEALTHY', 503);
      if (env.OPERATIONS_HEARTBEAT_URL) {
        const response = await fetch(env.OPERATIONS_HEARTBEAT_URL, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(5000) });
        if (!response.ok) return reply('HEARTBEAT_FAILED', 503);
      }
      return reply('OPERATIONS_OK', 200);
    } catch { return reply('OPERATIONS_FAILED', 503); }
    finally { if (lock) { await lock.query('select pg_advisory_unlock(100, 2201)').catch(() => {}); await lock.end().catch(() => {}); } }
  };
}
