import { post, readRecovery, prepareRecovery, validateStatus, storageKey } from './client.mjs';
const el = id => document.getElementById(id);
let config, session, busy = false, email = '', nextSend = 0, accepted = false;
function message(value) { el('message').textContent = value; }
const errors = {
  ORIGINAL_ACCOUNT_REQUIRED: 'Use the original account email for the saved deletion request.',
  REAUTH_REQUIRED: 'Request and verify a new email code before confirming deletion.',
  RATE_LIMITED: 'Too many requests. Wait at least a minute before trying again.',
  ACCOUNT_UNAVAILABLE: 'No eligible app account was found. Contact support if you need help.',
  NOT_FOUND_OR_FORBIDDEN: 'This request is not confirmed. Verify the original account and retry the saved request.',
  DELETION_ALREADY_REQUESTED: 'A different deletion request already exists. Check status in the browser or app where you originally requested it.',
};
function showStatus(result) {
  const value = validateStatus(result); accepted = true; session = null;
  for (const id of ['send-form','verify-form','delete-form']) el(id).hidden = true;
  el('recovery').hidden = false; el('forget').hidden = value.status !== 'complete';
  message(value.status === 'complete' ? 'Primary account cleanup is complete.' : 'Deletion accepted. Your account is hidden and primary cleanup is processing.');
}
async function run(action) {
  if (busy) return;
  busy = true; document.querySelectorAll('button').forEach(b => b.disabled = true);
  try { await action(); } catch (error) {
    message(errors[error.message] ?? 'Could not confirm the request. Keep this browser’s recovery record, check your connection and retry.');
  } finally { busy = false; document.querySelectorAll('button').forEach(b => b.disabled = false); }
}
el('send-form').addEventListener('submit', event => {
  event.preventDefault(); void run(async () => {
    if (accepted) return;
    if (Date.now() < nextSend) { message('Please wait a minute before requesting another code.'); return; }
    session = null; el('delete-form').hidden = true; el('confirm').checked = false;
    email = el('email').value.trim();
    await post(config, '/auth/v1/otp', { email, create_user: false });
    nextSend = Date.now() + 60000; el('verify-form').hidden = false;
    message('If this email has an eligible account, check its inbox for a verification code.');
  });
});
el('verify-form').addEventListener('submit', event => {
  event.preventDefault(); void run(async () => {
    session = null; el('delete-form').hidden = true;
    const result = await post(config, '/auth/v1/verify', { email, token: el('code').value.trim(), type: 'email' });
    if (!result.user?.id || !result.access_token) throw new Error('UNEXPECTED_RESPONSE');
    const saved = readRecovery(localStorage);
    if (saved && saved.accountId !== result.user.id) throw new Error('ORIGINAL_ACCOUNT_REQUIRED');
    session = { accountId: result.user.id, token: result.access_token };
    el('code').value = ''; el('confirm').checked = false; el('delete-form').hidden = false;
    message('Ownership verified. Review the deletion scope, then confirm.');
  });
});
el('delete-form').addEventListener('submit', event => {
  event.preventDefault(); void run(async () => {
    if (!session || !el('confirm').checked || accepted) return;
    // Persist and read back the recovery proof before any destructive network request.
    const saved = prepareRecovery(localStorage, session.accountId); el('recovery').hidden = false;
    showStatus(await post(config, '/rest/v1/rpc/request_account_deletion', { envelope: saved.envelope }, session.token));
  });
});
el('status').addEventListener('click', () => { void run(async () => {
  const saved = readRecovery(localStorage); if (!saved) throw new Error('RECOVERY_UNAVAILABLE');
  showStatus(await post(config, '/rest/v1/rpc/account_deletion_status', { status_token: saved.envelope.status_token }));
}); });
el('forget').addEventListener('click', () => { void run(async () => {
  const saved = readRecovery(localStorage);
  const result = validateStatus(await post(config, '/rest/v1/rpc/account_deletion_status', { status_token: saved.envelope.status_token }));
  if (result.status !== 'complete') throw new Error('NOT_COMPLETE');
  localStorage.removeItem(storageKey); location.reload();
}); });
try {
  const response = await fetch('/config.json', { cache: 'no-store' }); if (!response.ok) throw new Error(); config = await response.json();
  const saved = readRecovery(localStorage); el('recovery').hidden = !saved;
  el('send-form').hidden = false;
  message(saved ? 'A saved request was found. Check its status before retrying deletion.' : 'Verify your account email to continue.');
} catch { message('Account tools could not load, or browser recovery storage is unavailable. Contact support before continuing.'); }
