import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readEnvironment } from '../src/config/environment.ts';

test('development starts offline without service credentials', () => {
  assert.equal(readEnvironment({}).connected, false);
});
test('invalid and incomplete service configuration fails explicitly', () => {
  for (const values of [
    { EXPO_PUBLIC_APP_ENV: 'typo' },
    { EXPO_PUBLIC_SUPABASE_URL: 'https://example.com' },
    { EXPO_PUBLIC_APP_ENV: 'production' },
    { EXPO_PUBLIC_APP_ENV: 'production', EXPO_PUBLIC_SUPABASE_URL: 'https://example.com', EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'placeholder' },
  ]) assert.throws(() => readEnvironment(values));
});
