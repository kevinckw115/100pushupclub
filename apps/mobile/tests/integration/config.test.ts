import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('Expo resolves offline development config and blocks unconfigured production', () => {
  const run = (name: string) => spawnSync(process.execPath, ['node_modules/expo/bin/cli', 'config', '--json'], {
    encoding: 'utf8', env: { ...process.env, EXPO_PUBLIC_APP_ENV: name, EXPO_PUBLIC_SUPABASE_URL: '', EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: '' },
  });
  const development = run('development');
  assert.equal(development.status, 0, development.stderr);
  assert.equal(JSON.parse(development.stdout).extra.appEnvironment, 'development');
  assert.notEqual(run('production').status, 0);
});
