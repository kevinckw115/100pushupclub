import pg from 'pg';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
/** Privileged server process only. No identifiers, proof, text, or credentials in output. */
export async function operationsMetrics(dbUrl) {
  if (!dbUrl) throw new Error('Operations database connection is required');
  const db = new pg.Client({ connectionString: dbUrl, connectionTimeoutMillis: 5000 });
  await db.connect();
  try {
    await db.query("begin read only; set local statement_timeout='5s'");
    const deletion = (await db.query(`select count(*) filter(where status<>'complete')::integer pending_deletions,
      count(*) filter(where status='failed')::integer failed_deletions,
      coalesce(floor(extract(epoch from now()-min(requested_at) filter(where status<>'complete'))),0)::integer oldest_deletion_seconds
      from app_private.deletion_jobs`)).rows[0];
    const moderation = (await db.query("select count(*)::integer open_reports from app_private.reports where status='open'")).rows[0];
    await db.query('commit'); return { ...deletion, ...moderation };
  } finally { await db.end(); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await operationsMetrics(process.env.OPERATIONS_DATABASE_URL))); }
  catch { console.error('OPERATIONS_METRICS_UNAVAILABLE'); process.exitCode = 1; }
}
