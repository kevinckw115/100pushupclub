import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readEnvironment } from '../src/config/environment.ts';

test('development starts offline without service credentials', () => {
  assert.equal(readEnvironment({}).connected, false);
});
test('preview cannot silently become offline and privileged keys never enter client config', () => {
  const url = { EXPO_PUBLIC_SUPABASE_URL: 'https://project.supabase.co' };
  assert.throws(() => readEnvironment({ EXPO_PUBLIC_APP_ENV: 'preview' }));
  for (const role of ['service_role', 'authenticated']) {
    const key = 'eyJhbGciOiJIUzI1NiJ9.' + Buffer.from(JSON.stringify({ role })).toString('base64url') + '.test';
    assert.throws(() => readEnvironment({ ...url, EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: key }), /anon/);
  }
  assert.throws(() => readEnvironment({ ...url, EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_secret_test' }), /Server/);
  assert.equal(readEnvironment({ ...url, EXPO_PUBLIC_APP_ENV: 'preview', EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test' }).connected, true);
});
test('invalid and incomplete service configuration fails explicitly', () => {
  for (const values of [
    { EXPO_PUBLIC_APP_ENV: 'typo' },
    { EXPO_PUBLIC_SUPABASE_URL: 'https://example.com' },
    { EXPO_PUBLIC_APP_ENV: 'production' },
    { EXPO_PUBLIC_APP_ENV: 'production', EXPO_PUBLIC_SUPABASE_URL: 'https://example.com', EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'placeholder' },
  ]) assert.throws(() => readEnvironment(values));
});

test('HTTP is limited to disposable local development, never preview or production', () => {
  const key = { EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'test-public-key' };
  assert.equal(readEnvironment({ ...key, EXPO_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321' }).connected, true);
  for (const name of ['preview', 'production']) assert.throws(() => readEnvironment({ ...key, EXPO_PUBLIC_APP_ENV: name, EXPO_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321' }), /HTTPS/);
  for (const url of ['http://example.org', 'http://localhost:1234', 'http://127.0.0.1.evil.test:54321']) assert.throws(() => readEnvironment({ ...key, EXPO_PUBLIC_SUPABASE_URL: url }), /HTTPS/);
});
