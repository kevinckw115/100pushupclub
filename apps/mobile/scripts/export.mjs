import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { auditDirectory } from './audit-bundle.mjs';
if (existsSync('app/_dev')) throw new Error('Generated review routes must be removed before an app export.');
const result = spawnSync(process.execPath, ['node_modules/expo/bin/cli', 'export', '--platform', process.argv[2] ?? 'all'], { stdio: 'inherit' });
if (result.status !== 0) process.exit(result.status ?? 1);
const entries = readdirSync('dist/_expo/static/js/web').filter(name => name.startsWith('entry-'));
for (const name of entries) {
  const bundle = readFileSync(`dist/_expo/static/js/web/${name}`, 'utf8');
  for (const marker of ['test_write_failure', 'Development component review', 'node:sqlite']) {
    if (bundle.includes(marker)) throw new Error(`Review-only code found in app bundle: ${marker}`);
  }
}
console.log('PASS: ordinary web bundle excludes development review and host SQLite test modules.');
const audited = auditDirectory('dist');
if (!audited) throw new Error('No textual export files audited');
console.log(`PASS: ${audited} textual export files checked for privileged credentials and review modules.`);
