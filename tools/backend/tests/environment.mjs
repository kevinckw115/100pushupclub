import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

export function localEnvironment() {
  const result = spawnSync(process.execPath, ['scripts/cli.mjs', 'status', '-o', 'json'], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error('Start the disposable local Supabase stack before running backend tests.');
  let config;
  try { config = JSON.parse(result.stdout); } catch { throw new Error('Supabase status did not return JSON.'); }
  const api = config.API_URL, db = config.DB_URL;
  const key = config.ANON_KEY ?? config.PUBLISHABLE_KEY;
  const adminKey = config.SERVICE_ROLE_KEY ?? config.SECRET_KEY;
  if (!api || !db || !key || !adminKey) throw new Error('Missing local Supabase API/database/key fields: ' + Object.keys(config).join(','));
  for (const value of [api, db]) if (!['127.0.0.1', 'localhost', '[::1]'].includes(new URL(value).hostname)) throw new Error('Backend tests refuse non-local projects.');
  return { api, db, key, adminKey };
}

export async function request(config, path, { token, admin = false, method = 'POST', body, headers = {} } = {}) {
  const response = await fetch(config.api + path, { method, headers: {
    apikey: admin ? config.adminKey : config.key,
    ...(token || admin ? { Authorization: 'Bearer ' + (admin ? config.adminKey : token) } : {}),
    'Content-Type': 'application/json', ...headers,
  }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: response.status, data: await response.json().catch(() => null) };
}

export async function account(config) {
  const email = `test-${randomUUID()}@example.invalid`, password = randomUUID() + 'Aa1!';
  const created = await request(config, '/auth/v1/admin/users', { admin: true, body: { email, password, email_confirm: true } });
  if (created.status >= 400 || !created.data?.id) throw new Error('Local test account creation failed: HTTP ' + created.status);
  const login = await request(config, '/auth/v1/token?grant_type=password', { body: { email, password } });
  if (login.status !== 200 || !login.data?.access_token) throw new Error('Local test login failed: HTTP ' + login.status);
  return { id: created.data.id, token: login.data.access_token };
}

export async function removeAccount(config, user) {
  const result = await request(config, '/auth/v1/admin/users/' + user.id, { admin: true, method: 'DELETE' });
  if (result.status >= 400) throw new Error('Local test account cleanup failed: HTTP ' + result.status);
}
