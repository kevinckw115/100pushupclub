import pg from 'pg';
import { pathToFileURL } from 'node:url';

/** Server-only bounded worker. Its credentials never enter the app or output. */
export async function runDeletionWorker({ dbUrl, apiUrl, adminKey, steps = 25 }) {
  if (!dbUrl || !apiUrl || !adminKey || !Number.isInteger(steps) || steps < 1 || steps > 100) throw new Error('Configure worker database/API/admin credentials and1–100 steps.');
  const endpoint = new URL(apiUrl);
  if ((endpoint.protocol !== 'https:' && !(endpoint.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(endpoint.hostname))) || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) throw new Error('Worker API requires a clean HTTPS project URL or disposable localhost.');
  const db = new pg.Client({ connectionString: dbUrl, connectionTimeoutMillis: 5000 });
  const counts = { advanced: 0, completed: 0, failed: 0 };
  await db.connect();
  try {
    for (let i = 0; i < steps; i++) {
      const jobs = await db.query("select user_id from app_private.deletion_jobs where status<>'complete' and (status<>'failed' or last_attempt_at<now()-interval '1 minute') order by last_attempt_at nulls first,requested_at limit 1");
      if (!jobs.rowCount) break;
      const actor = jobs.rows[0].user_id;
      try {
        const phase = (await db.query('select app_private.advance_deletion($1) phase', [actor])).rows[0].phase;
        if (phase === 'auth') {
          const response = await fetch(apiUrl.replace(/\/$/, '') + '/auth/v1/admin/users/' + actor, { method: 'DELETE', headers: { apikey: adminKey, Authorization: 'Bearer ' + adminKey }, signal: AbortSignal.timeout(15000) });
          const data = await response.json().catch(() => null);
          if (!response.ok && !(response.status === 404 && data?.code === 'user_not_found')) throw new Error('AUTH_DELETE_RETRY');
          // A successful Auth response must agree with database absence before reporting completion.
          const remaining = await db.query('select 1 from auth.users where id=$1', [actor]); if (remaining.rowCount) throw new Error('AUTH_DELETE_RETRY');
          await db.query("update app_private.deletion_jobs set status='complete',phase='complete',completed_at=clock_timestamp(),error_code=null where user_id=$1 and phase='auth'", [actor]); counts.completed++;
        } else counts.advanced++;
      } catch {
        await db.query("update app_private.deletion_jobs set status='failed',last_attempt_at=clock_timestamp(),error_code='CLEANUP_RETRY' where user_id=$1 and status<>'complete'", [actor]); counts.failed++;
      }
    }
  } finally { await db.end(); }
  return counts;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runDeletionWorker({ dbUrl: process.env.DELETION_DATABASE_URL, apiUrl: process.env.DELETION_API_URL, adminKey: process.env.DELETION_ADMIN_KEY, steps: Number(process.env.DELETION_MAX_STEPS ?? 25) })
    .then(counts => { console.log(JSON.stringify(counts)); if (counts.failed) process.exitCode = 1; })
    .catch(() => { console.error('Deletion worker could not run. Check server configuration and database access.'); process.exitCode = 1; });
}
