import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function buildDirectory(sources, version) {
  const lines = text => text.split(/\r?\n/).filter(line => line && !line.startsWith('#')).map(line => line.split('\t'));
  const records = [{ id: 'world', parent_id: null, kind: 'world', name: 'World', country_code: null, source_geoname_id: null, source_code: 'world', source_version: version }];
  const codes = new Map(), identifiers = new Set(['world']);
  const add = (kind, code, name, geoname, parent, country) => {
    if (!/^\d+$/.test(geoname ?? '') || BigInt(geoname) <= 0n || BigInt(geoname) > 9223372036854775807n || !name || [...name].length > 200) throw new Error('Invalid source row: ' + code);
    const id = 'gn:' + geoname;
    if (codes.has(code) || identifiers.has(id)) throw new Error('Duplicate region: ' + code);
    if (!identifiers.has(parent)) throw new Error('Orphan parent: ' + code);
    records.push({ id, parent_id: parent, kind, name, country_code: country, source_geoname_id: geoname, source_code: code, source_version: version });
    codes.set(code, id); identifiers.add(id);
  };
  // These historic entries are explicitly identified in countryInfo's source notes.
  const retired = new Set(['AN', 'CS']);
  for (const row of lines(sources.country)) {
    if (!/^[A-Z]{2}$/.test(row[0])) throw new Error('Invalid country code.');
    if (!retired.has(row[0])) add('country', row[0], row[4], row[16], 'world', row[0]);
  }
  for (const row of lines(sources.admin1)) {
    const country = row[0].split('.')[0];
    if (retired.has(country)) continue;
    if (!codes.has(country)) throw new Error('Orphan country: ' + row[0]);
    add('admin1', row[0], row[1], row[3], codes.get(country), country);
  }
  for (const row of lines(sources.admin2)) {
    if (!row[0].startsWith('US.')) continue;
    const parent = row[0].split('.').slice(0, 2).join('.');
    if (!codes.has(parent)) throw new Error('Orphan locality: ' + row[0]);
    add('locality', row[0], row[1], row[3], codes.get(parent), 'US');
  }
  const byId = new Map(records.map(r => [r.id, r]));
  const ancestors = [];
  for (const record of records) {
    let current = record; const visited = new Set();
    while (current) {
      if (visited.has(current.id)) throw new Error('Region cycle.');
      visited.add(current.id); ancestors.push([record.id, current.id]);
      current = current.parent_id ? byId.get(current.parent_id) : null;
    }
  }
  return { version, records, ancestors };
}

export function fromSnapshot(directory) {
  const manifest = JSON.parse(readFileSync(resolve(directory, 'manifest.json'), 'utf8'));
  const buffers = {};
  for (const file of manifest.files) {
    if (!['countryInfo.txt', 'admin1CodesASCII.txt', 'admin2Codes.txt', 'readme.txt'].includes(file.name)) throw new Error('Unexpected manifest file.');
    const bytes = readFileSync(resolve(directory, file.name));
    if (createHash('sha256').update(bytes).digest('hex') !== file.sha256 || bytes.length !== file.bytes) throw new Error('Source checksum mismatch: ' + file.name);
    buffers[file.name] = bytes.toString('utf8');
  }
  return buildDirectory({ country: buffers['countryInfo.txt'], admin1: buffers['admin1CodesASCII.txt'], admin2: buffers['admin2Codes.txt'] }, manifest.version);
}

export function sqlFor(directory) {
  const literal = value => value === null ? 'NULL' : "'" + String(value).replaceAll("'", "''") + "'";
  const chunks = ['-- Generated from the checked GeoNames snapshot. See data/regions/README.md.'];
  if (directory.manifest) chunks.push('INSERT INTO app_private.directory_versions(version,manifest,current) VALUES(' + literal(directory.version) + ',' + literal(JSON.stringify(directory.manifest)) + '::jsonb,true);');
  for (let index = 0; index < directory.records.length; index += 250) {
    const rows = directory.records.slice(index, index + 250);
    chunks.push('INSERT INTO app_private.regions(id,parent_id,kind,name,country_code,source_geoname_id,source_code,source_version) VALUES\n' + rows.map(row => '(' + [row.id, row.parent_id, row.kind, row.name, row.country_code, row.source_geoname_id, row.source_code, row.source_version].map(literal).join(',') + ')').join(',\n') + '\nON CONFLICT(id) DO NOTHING;');
  }
  for (let index = 0; index < directory.ancestors.length; index += 500) {
    chunks.push('INSERT INTO app_private.region_ancestors(region_id,ancestor_id) VALUES\n' + directory.ancestors.slice(index, index + 500).map(row => '(' + row.map(literal).join(',') + ')').join(',\n') + '\nON CONFLICT DO NOTHING;');
  }
  return chunks.join('\n') + '\n';
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const date = process.argv[2]; if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? '')) throw new Error('Supply snapshot date.');
  const directory = fromSnapshot(resolve('data/regions', date));
  directory.manifest = JSON.parse(readFileSync(resolve('data/regions', date, 'manifest.json'), 'utf8'));
  writeFileSync('supabase/migrations/20260911000200_region_snapshot.sql', sqlFor(directory));
  console.log(JSON.stringify({ records: directory.records.length, ancestors: directory.ancestors.length, kinds: Object.fromEntries(['country', 'admin1', 'locality'].map(kind => [kind, directory.records.filter(r => r.kind === kind).length])) }));
}
