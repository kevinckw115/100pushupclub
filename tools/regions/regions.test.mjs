import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildDirectory, fromSnapshot, sqlFor } from './build.mjs';
const root = new URL('../../', import.meta.url);
test('checked snapshot builds the source hierarchy deterministically without coordinates', () => {
  const directory = fromSnapshot(fileURLToPath(new URL('data/regions/2026-09-11/', root)));
  assert.equal(directory.records.length, 7259); assert.equal(directory.ancestors.length, 24668);
  const county = directory.records.find(r => r.source_code === 'US.CA.059');
  assert.equal(county.name, 'Orange County');
  assert.equal(directory.records.find(r => r.id === county.parent_id).name, 'California');
  assert.equal(directory.ancestors.filter(([id]) => id === county.id).length, 4);
  assert.equal(directory.records.some(r => r.kind === 'locality' && r.country_code !== 'US'), false);
  assert.equal(directory.records.some(r => ['AN', 'CS'].includes(r.source_code)), false);
  assert.equal(directory.records.some(r => 'latitude' in r || 'longitude' in r), false);
  directory.manifest = JSON.parse(readFileSync(new URL('data/regions/2026-09-11/manifest.json', root), 'utf8'));
  assert.equal(sqlFor(directory), readFileSync(new URL('supabase/migrations/20260911000200_region_snapshot.sql', root), 'utf8').replaceAll('\r\n', '\n'));
});
test('source parser rejects orphan and duplicate identities instead of inventing parents', () => {
  const country = ['US', '', '', '', 'United States', '', '', '', '', '', '', '', '', '', '', '', '6252001'].join('\t');
  const valid = { country, admin1: 'US.CA\tCalifornia\tCalifornia\t5332921', admin2: 'US.CA.059\tOrange County\tOrange County\t5379524' };
  assert.equal(buildDirectory(valid, 'test').records.length, 4);
  assert.throws(() => buildDirectory({ ...valid, admin2: 'US.MISSING.1\tOrphan\tOrphan\t123' }, 'test'), /Orphan/);
  assert.throws(() => buildDirectory({ ...valid, admin1: valid.admin1 + '\n' + valid.admin1 }, 'test'), /Duplicate/);
  assert.throws(() => buildDirectory({ ...valid, admin1: 'US.CA\tCalifornia\tCalifornia\tbad' }, 'test'), /Invalid source/);
});
