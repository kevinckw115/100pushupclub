import { existsSync, mkdirSync, writeFileSync, unlinkSync, rmdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const directory = path.resolve('app/_dev');
const routes = {
  'components.tsx': "export { default } from '../../src/testing/ComponentGallery';\n",
  'storage.tsx': "export { default } from '../../src/testing/StorageFailureReview';\n",
};
if (existsSync(directory)) throw new Error('Remove stale generated app/_dev review routes before rebuilding.');
mkdirSync(directory);
try {
  for (const [name, source] of Object.entries(routes)) writeFileSync(path.join(directory, name), source);
  const result = spawnSync(process.execPath, ['node_modules/expo/bin/cli', 'export', '--platform', 'web', '--dev', '--no-minify'], { stdio: 'inherit' });
  process.exitCode = result.status ?? 1;
} finally {
  for (const name of Object.keys(routes)) if (existsSync(path.join(directory, name))) unlinkSync(path.join(directory, name));
  rmdirSync(directory);
}
