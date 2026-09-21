import { Buffer } from 'node:buffer';
const project = 'ggeyfolfedercmfvwsqx';
export function validateHostedOperations(env) {
  if (env.DELETION_API_URL !== `https://${project}.supabase.co`) throw new Error('OPERATIONS_TARGET_INVALID');
  let db;
  try { db = new URL(env.DELETION_DATABASE_URL); } catch { throw new Error('OPERATIONS_DATABASE_INVALID'); }
  const direct = db.hostname === `db.${project}.supabase.co` && decodeURIComponent(db.username) === 'postgres';
  const pooled = db.hostname.endsWith('.pooler.supabase.com') && decodeURIComponent(db.username) === `postgres.${project}`;
  if (!['postgres:', 'postgresql:'].includes(db.protocol) || (!direct && !pooled) || !db.password ||
      (db.port && db.port !== '5432') || db.pathname !== '/postgres' ||
      db.searchParams.get('sslmode') !== 'verify-full') throw new Error('OPERATIONS_DATABASE_INVALID');
  let claims;
  try { claims = JSON.parse(Buffer.from(env.DELETION_ADMIN_KEY.split('.')[1], 'base64url').toString()); } catch { throw new Error('OPERATIONS_ADMIN_KEY_INVALID'); }
  // Configuration check only. Supabase still verifies the actual JWT signature.
  if (claims.role !== 'service_role' || claims.ref !== project) throw new Error('OPERATIONS_ADMIN_KEY_INVALID');
  if (env.OPERATIONS_HEARTBEAT_URL) {
    let heartbeat;
    try { heartbeat = new URL(env.OPERATIONS_HEARTBEAT_URL); } catch { throw new Error('OPERATIONS_HEARTBEAT_INVALID'); }
    if (heartbeat.protocol !== 'https:' || heartbeat.username || heartbeat.password || heartbeat.hash) throw new Error('OPERATIONS_HEARTBEAT_INVALID');
  }
}
export function healthFailures(metrics) {
  const fields = ['pending_deletions','failed_deletions','oldest_deletion_seconds','open_reports'];
  if (!metrics || fields.some(key => !Number.isSafeInteger(metrics[key]) || metrics[key] < 0)) return ['METRICS_INVALID'];
  const codes = [];
  if (metrics.failed_deletions > 0) codes.push('DELETION_FAILED');
  if (metrics.oldest_deletion_seconds >= 86400) codes.push('DELETION_OLDER_THAN_ONE_DAY');
  return codes;
}
