import { readdirSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Buffer } from 'node:buffer';
export function auditText(source) {
  const forbidden = [/sb_secret_[A-Za-z0-9_-]+/, /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/, /postgres(?:ql)?:\/\/[^\s"']+:[^\s"']+@/, /test_write_failure|Development component review|node:sqlite/];
  if (forbidden.some(pattern => pattern.test(source))) throw new Error('Forbidden credential or development code in export');
  for (const token of source.match(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g) ?? []) {
    try { const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()); if (payload.role && payload.role !== 'anon') throw new Error('PRIVATE_KEY'); }
    catch (error) { if (error.message === 'PRIVATE_KEY') throw new Error('Privileged JWT in export'); }
  }
}
export function auditDirectory(directory) {
  let files = 0;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files += auditDirectory(path);
    else if (/\.(?:js|json|html|map)$/.test(entry.name)) { auditText(readFileSync(path, 'utf8')); files++; }
  }
  return files;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const files = auditDirectory('dist'); if (!files) throw new Error('No export files to audit');
  console.log(`PASS: ${files} textual export files audited. Native binary permissions still require installed-build inspection.`);
}
