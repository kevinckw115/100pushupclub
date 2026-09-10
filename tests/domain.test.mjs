import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseQuantity, canonicalInstant, localDateAt, dayMetrics, ReferenceLedger } from '../reference/domain.mjs';

const fixtures = JSON.parse(readFileSync(new URL('../fixtures/scenarios.json', import.meta.url)));
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const create = (n=1, quantity=20) => ({ kind:'create', mutation_id:id(n), checkin_id:id(100+n), quantity,
  occurred_at:'2026-09-10T15:15:00Z', recorded_timezone:'America/Los_Angeles', local_date:'2026-09-10', source:'native', requested_public_epoch:null });

test('quantities accept boundaries, trim and normalize', () => {
  for (const value of [1,999,'5',' 010 ']) assert.equal(parseQuantity(value), Number(value));
});
test('quantities reject invalid and ambiguous values', () => {
  for (const value of ['', ' ',0,-1,1000,1.5,NaN,Infinity,null,true,'1e2','5x','+5','1.0']) assert.throws(() => parseQuantity(value), /INVALID_QUANTITY/);
});
test('timestamp canonicalization rejects impossible dates', () => {
  assert.equal(canonicalInstant('2026-09-10T15:15:00Z'),'2026-09-10T15:15:00.000Z');
  assert.equal(canonicalInstant('2026-09-10T15:15:00.123Z'),'2026-09-10T15:15:00.123Z');
  for (const value of ['2026-02-30T00:00:00Z','2026-09-10','bad']) assert.throws(() => canonicalInstant(value));
});
for (const fixture of fixtures.day_metrics) test(`day fixture: ${fixture.name}`, () => {
  const rows = fixture.quantities.map(quantity => ({quantity,local_date:'2026-09-10',deleted_at:null}));
  assert.deepEqual(dayMetrics(rows,'2026-09-10'),fixture.expected);
});
for (const fixture of fixtures.timezones) test(`timezone fixture: ${fixture.name}`, () => {
  assert.equal(localDateAt(fixture.instant, fixture.zone),fixture.date);
});
test('deleted and other-day records do not contribute', () => {
  assert.equal(dayMetrics([{quantity:20,local_date:'2026-09-10',deleted_at:'deleted'}, {quantity:30,local_date:'2026-09-09'}],'2026-09-10').total,'0');
});
test('invalid timezone fails clearly', () => assert.throws(() => localDateAt('2026-09-10T00:00:00Z','Not/AZone'), /INVALID_TIMEZONE/));
test('missing timezone must not fall back to the test machine timezone', () => {
  for (const zone of [undefined, null, '', ' ']) assert.throws(() => localDateAt('2026-09-10T00:00:00Z',zone), /INVALID_TIMEZONE/);
});
test('lost response and exact retry return identical receipt with one change', () => {
  const ledger = new ReferenceLedger();
  const first = ledger.apply('A',create());
  assert.deepEqual(ledger.apply('A',create()),first);
  assert.equal(ledger.pull('A').changes.length,1);
});
test('semantic JSON order does not change idempotency', () => {
  const ledger = new ReferenceLedger(); const request=create();
  const first=ledger.apply('A',request);
  assert.deepEqual(ledger.apply('A',Object.fromEntries(Object.entries(request).reverse())),first);
});
test('same mutation ID with different quantity fails without mutation', () => {
  const ledger = new ReferenceLedger(); ledger.apply('A',create());
  assert.throws(() => ledger.apply('A',create(1,30)), /IDEMPOTENCY_KEY_REUSED/);
  assert.equal(ledger.pull('A').changes[0].quantity,20);
});
test('new mutation ID cannot create duplicate entity', () => {
  const ledger=new ReferenceLedger(); ledger.apply('A',create());
  assert.throws(() => ledger.apply('A',{...create(),mutation_id:id(9)}),/ENTITY_EXISTS/);
});
test('stale concurrent edit conflicts; original date remains immutable', () => {
  const ledger=new ReferenceLedger(); ledger.apply('A',create());
  const update={kind:'update',mutation_id:id(2),checkin_id:id(101),quantity:30,expected_version:1};
  const result=ledger.apply('A',update);
  assert.equal(result.record.local_date,'2026-09-10');
  assert.equal(result.record.version,2);
  assert.throws(() => ledger.apply('A',{...update,mutation_id:id(3),quantity:40}),/VERSION_CONFLICT/);
});
test('delete replay is safe and stale update cannot resurrect', () => {
  const ledger=new ReferenceLedger(); ledger.apply('A',create());
  const deletion={kind:'delete',mutation_id:id(2),checkin_id:id(101),expected_version:1};
  const result=ledger.apply('A',deletion);
  assert.deepEqual(ledger.apply('A',deletion),result);
  assert.throws(() => ledger.apply('A',{kind:'update',mutation_id:id(3),checkin_id:id(101),quantity:10,expected_version:2}),/VERSION_CONFLICT/);
});
test('reference actors cannot read or mutate other actors records', () => {
  const ledger=new ReferenceLedger(); ledger.apply('A',create());
  assert.equal(ledger.pull('B').changes.length,0);
  assert.throws(() => ledger.apply('B',{kind:'delete',mutation_id:id(2),checkin_id:id(101),expected_version:1}),/NOT_FOUND_OR_FORBIDDEN/);
});
test('cursor pages include updates and tombstones in revision order', () => {
  const ledger=new ReferenceLedger(); ledger.apply('A',create());
  ledger.apply('A',{kind:'update',mutation_id:id(2),checkin_id:id(101),quantity:30,expected_version:1});
  ledger.apply('A',{kind:'delete',mutation_id:id(3),checkin_id:id(101),expected_version:2});
  const first=ledger.pull('A','0',2); assert.equal(first.has_more,true); assert.equal(first.next_revision,'2');
  const second=ledger.pull('A',first.next_revision,2); assert.equal(second.has_more,false); assert.equal(second.next_revision,'3');
  assert.ok(second.changes[0].deleted_at); assert.equal(first.changes[0].quantity,20);
});
test('caller mutation of response cannot corrupt receipt or ledger', () => {
  const ledger=new ReferenceLedger(); const first=ledger.apply('A',create()); first.record.quantity=999;
  assert.equal(ledger.apply('A',create()).record.quantity,20);
});
test('invalid local date and future clock fail without allocating a revision', () => {
  const ledger=new ReferenceLedger();
  assert.throws(() => ledger.apply('A',{...create(),local_date:'2026-09-09'}),/INVALID_LOCAL_DATE/);
  assert.throws(() => ledger.apply('A',{...create(),occurred_at:'2026-09-10T18:06:00Z'}),/CLOCK_AHEAD/);
  assert.equal(ledger.pull('A').next_revision,'0');
});
test('imported history remains private in the reference contract', () => {
  const result=new ReferenceLedger().apply('A',{...create(),source:'import'});
  assert.equal(result.effective_public,false); assert.equal(result.record.public_epoch,null);
});
test('circle visual fixture sums to 185 with four participants', () => {
  const members=fixtures.circle.members;
  assert.equal(members.reduce((n,m) => n+m.total,0),185);
  assert.equal(members.filter(m=>m.total>0).length,4);
  assert.equal(members.length,6);
});
