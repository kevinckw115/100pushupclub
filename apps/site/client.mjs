export const storageKey = '100pushupclub.deletion.v1';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function readRecovery(storage) {
  const raw = storage.getItem(storageKey);
  if (!raw) return null;
  const value = JSON.parse(raw);
  if (!uuid.test(value?.accountId) || !uuid.test(value?.envelope?.operation_id) ||
      !/^d_[a-f0-9]{64}$/.test(value?.envelope?.status_token) || value.envelope.confirm_delete !== true) {
    throw new Error('RECOVERY_UNAVAILABLE');
  }
  return value;
}
export function prepareRecovery(storage, accountId) {
  const saved = readRecovery(storage);
  if (saved) {
    if (saved.accountId !== accountId) throw new Error('ORIGINAL_ACCOUNT_REQUIRED');
    return saved;
  }
  if (!uuid.test(accountId)) throw new Error('INVALID_ACCOUNT');
  const value = { accountId, envelope: { operation_id: crypto.randomUUID(), status_token: 'd_' + Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, '0')).join(''), confirm_delete: true } };
  storage.setItem(storageKey, JSON.stringify(value));
  if (JSON.stringify(readRecovery(storage)) !== JSON.stringify(value)) throw new Error('RECOVERY_UNAVAILABLE');
  return value;
}
export function validateStatus(value) {
  if (!uuid.test(value?.job_id) || !uuid.test(value?.request_id) || !['processing','complete'].includes(value?.status) || value.completion_target_days !== 7) throw new Error('UNEXPECTED_RESPONSE');
  return value;
}
export async function post(config, path, body, token) {
  const response = await fetch(config.api + path, { method: 'POST', cache: 'no-store', signal: AbortSignal.timeout(15000), headers: { apikey: config.key, 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok) {
    const allowed = ['REAUTH_REQUIRED','RATE_LIMITED','ACCOUNT_UNAVAILABLE','NOT_FOUND_OR_FORBIDDEN','DELETION_ALREADY_REQUESTED'];
    throw new Error(response.status === 429 ? 'RATE_LIMITED' : allowed.includes(data?.code) ? data.code : 'REQUEST_FAILED');
  }
  return data;
}
