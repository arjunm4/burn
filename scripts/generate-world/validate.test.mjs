import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateWorld } from './validate.mjs';
import { checkTime, toPacificIso } from './schema.mjs';

const root = new URL('../../fixtures/world/', import.meta.url);
const load = (p) => JSON.parse(readFileSync(new URL(p, root), 'utf8'));
const world = load('example/world.json');
const answers = load('example/answers.json');

test('example world and answers are valid', () => {
  const r = validateWorld(world, answers);
  assert.deepEqual(r.errors, []);
  assert.equal(r.counts.people, 5);
  assert.equal(r.counts.orders_xometry, 2);
});

test('wrong Pacific offset and unresolved reference fail', () => {
  const w = structuredClone(world);
  w.orders[0].placed_at = '2026-09-08T14:12:00-08:00'; // September is PDT
  w.events[0].by = 'p-nobody';
  const { errors } = validateWorld(w, answers);
  assert.ok(errors.some((e) => e.includes('placed_at') && e.includes('should be -07:00')), errors.join('\n'));
  assert.ok(errors.some((e) => e.includes('unresolved people reference p-nobody')), errors.join('\n'));
});

test('missing answers entry and unordered history fail', () => {
  const a = structuredClone(answers);
  a.orders = a.orders.filter((x) => x.order !== 'ord-x-00002');
  const w = structuredClone(world);
  w.deliverables[0].eta.reverse();
  const { errors } = validateWorld(w, a);
  assert.ok(errors.some((e) => e.includes('no answers entry for Xometry order ord-x-00002')), errors.join('\n'));
  assert.ok(errors.some((e) => e.includes('history not ordered by known_at')), errors.join('\n'));
});

test('bad enum and missing required field fail', () => {
  const w = structuredClone(world);
  w.orders[0].chosen_tier = 'rush';
  delete w.people[0].email;
  const { errors } = validateWorld(w, answers);
  assert.ok(errors.some((e) => e.includes('"rush" not in enum tier')));
  assert.ok(errors.some((e) => e.includes('.email: required')));
});

test('time helpers follow US Pacific DST', () => {
  assert.equal(checkTime('2026-03-08T01:59:00-08:00'), null);
  assert.equal(checkTime('2026-03-08T03:00:00-07:00'), null);
  assert.equal(checkTime('2026-11-01T01:30:00-08:00'), null);
  assert.match(checkTime('2026-11-10T10:30:00-07:00'), /should be -08:00/);
  assert.equal(toPacificIso(Date.parse('2026-11-10T18:30:00Z')), '2026-11-10T10:30:00-08:00');
});
