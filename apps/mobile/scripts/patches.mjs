import { readdirSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
for (const file of readdirSync('patches').filter(name => name.endsWith('.patch'))) {
  const match = /^(.+)\+([^+]+)\.patch$/.exec(file);
  if (!match) throw new Error('Unrecognized dependency patch filename.');
  const name = match[1].replaceAll('+', '/');
  const installed = JSON.parse(readFileSync(`node_modules/${name}/package.json`, 'utf8')).version;
  if (installed !== match[2]) throw new Error(`Review and revalidate the ${name} patch for installed version ${installed} before continuing.`);
}
const result = spawnSync(process.execPath, ['node_modules/patch-package/index.js'], { stdio: 'inherit' });
if (result.status !== 0) process.exit(result.status ?? 1);
