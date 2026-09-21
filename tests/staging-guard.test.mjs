import test from 'node:test';
import assert from 'node:assert/strict';
import { validateStaging } from '../scripts/staging-guard.mjs';

const env = {
  GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REF: 'refs/heads/main',
  GITHUB_SHA: 'a'.repeat(40), SUPABASE_PROJECT_ID: 'ggeyfolfedercmfvwsqx',
  SUPABASE_ACCESS_TOKEN: 'test-token', SUPABASE_DB_PASSWORD: 'test-password',
  DEPLOY_MODE: 'preview', REVIEWED_SHA: '',
};

test('preview and apply with the reviewed commit are accepted', () => {
  assert.doesNotThrow(() => validateStaging(env));
  assert.doesNotThrow(() => validateStaging({ ...env, DEPLOY_MODE: 'apply', REVIEWED_SHA: env.GITHUB_SHA }));
});

test('wrong target, automatic trigger, branch and missing credentials fail closed', () => {
  for (const override of [
    { SUPABASE_PROJECT_ID: 'other-project' }, { GITHUB_EVENT_NAME: 'push' },
    { GITHUB_REF: 'refs/heads/feature' }, { SUPABASE_ACCESS_TOKEN: '' },
    { SUPABASE_DB_PASSWORD: ' ' }, { DEPLOY_MODE: 'reset' },
  ]) assert.throws(() => validateStaging({ ...env, ...override }));
});

test('apply rejects missing, abbreviated and stale preview commits without exposing secrets', () => {
  for (const REVIEWED_SHA of ['', 'aaaaaaa', 'b'.repeat(40)]) {
    assert.throws(() => validateStaging({ ...env, DEPLOY_MODE: 'apply', REVIEWED_SHA }), error => {
      assert.ok(!error.message.includes(env.SUPABASE_ACCESS_TOKEN));
      assert.ok(!error.message.includes(env.SUPABASE_DB_PASSWORD));
      return /reviewed preview/.test(error.message);
    });
  }
});
