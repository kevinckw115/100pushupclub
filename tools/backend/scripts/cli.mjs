import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const shim = fileURLToPath(new URL('../node_modules/supabase/dist/supabase.js', import.meta.url));
const result = spawnSync(process.execPath, [shim, ...process.argv.slice(2)], { cwd: fileURLToPath(new URL('../../../', import.meta.url)), stdio: 'inherit' });
if (result.error) console.error(`Supabase CLI could not start: ${result.error.code}`);
process.exitCode = result.status ?? 1;
