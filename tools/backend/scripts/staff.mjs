import { readFileSync } from 'node:fs';
const [command, ...args] = process.argv.slice(2);
const usage = 'Usage: node scripts/staff.mjs list [--after REPORT_UUID] [--limit 25]\n       node scripts/staff.mjs moderate ACTION SUBJECT --operation-id UUID --reason-file FILE [--resolution resolved|dismissed]';
if (!['list', 'moderate'].includes(command)) { console.log(usage); process.exit(command ? 1 : 0); }
const url = process.env.STAFF_API_URL, key = process.env.STAFF_PUBLISHABLE_KEY, token = process.env.STAFF_ACCESS_TOKEN;
if (!url || !key || !token) throw new Error('Set STAFF_API_URL, STAFF_PUBLISHABLE_KEY and STAFF_ACCESS_TOKEN in the staff environment. Never use a service-role key.');
const endpoint = new URL(url);
if (endpoint.protocol !== 'https:' && !(endpoint.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(endpoint.hostname))) throw new Error('Staff API requires HTTPS outside disposable localhost.');
if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash) throw new Error('Use the project base URL without credentials or query parameters.');
const options = {}, positional = [];
for (let i = 0; i < args.length; i++) {
  if (args[i].startsWith('--')) { if (options[args[i]] || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error(usage); options[args[i]] = args[++i]; }
  else positional.push(args[i]);
}
let operation, body;
if (command === 'list') {
  if (positional.length || Object.keys(options).some(key => !['--after', '--limit'].includes(key))) throw new Error(usage);
  operation = 'staff_list_reports'; body = { after_report: options['--after'] ?? null, limit: Number(options['--limit'] ?? 25) };
} else {
  if (positional.length !== 2 || Object.keys(options).some(key => !['--operation-id', '--reason-file', '--resolution'].includes(key)) || !options['--operation-id'] || !options['--reason-file']) throw new Error(usage);
  operation = 'staff_moderate'; body = { envelope: { operation_id: options['--operation-id'], action: positional[0], subject_id: positional[1], reason: readFileSync(options['--reason-file'], 'utf8').trim(), ...(options['--resolution'] ? { resolution: options['--resolution'] } : {}) } };
}
const response = await fetch(url.replace(/\/$/, '') + '/rest/v1/rpc/' + operation, { method: 'POST', headers: { apikey: key, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) });
if (!response.ok) { console.error('Staff operation did not complete: HTTP ' + response.status + '. Keep the same operation ID when retrying unchanged intent.'); process.exit(1); }
console.log(JSON.stringify(await response.json(), null, 2));
