import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeRng } from './rng.mjs';
import { makeCalendar, addDays, dow, weekStart, atLocal, addMinutes, localDate } from './calendar.mjs';
import { readJson, writeJson, stringify, sortById, sha256 } from './io.mjs';
import { checkTime } from '../schema.mjs';

const canon = readJson(fileURLToPath(new URL('../../../fixtures/world/seed/canon.json', import.meta.url)));

test('rng: same seed and label give the same stream; forks are independent of parent draws', () => {
  const a = makeRng(1).fork('x');
  const parent = makeRng(1);
  parent.float(); parent.float();
  const b = parent.fork('x');
  assert.deepEqual([a.float(), a.int(1, 6), a.poisson(9)], [b.float(), b.int(1, 6), b.poisson(9)]);
  assert.notEqual(makeRng(1).fork('x').float(), makeRng(1).fork('y').float());
  assert.notEqual(makeRng(1).float(), makeRng(2).float());
});

test('rng: distributions are sane', () => {
  const r = makeRng(7);
  let sum = 0; let pois = 0; const counts = { a: 0, b: 0 };
  const logs = [];
  for (let i = 0; i < 4000; i++) {
    const x = r.float(); assert.ok(x >= 0 && x < 1); sum += x;
    const n = r.int(2, 5); assert.ok(n >= 2 && n <= 5);
    pois += r.poisson(9);
    counts[r.weighted({ a: 3, b: 1 })]++;
    logs.push(r.lognormal(4, 0.5));
  }
  assert.ok(Math.abs(sum / 4000 - 0.5) < 0.03);
  assert.ok(Math.abs(pois / 4000 - 9) < 0.3);
  assert.ok(Math.abs(counts.a / 4000 - 0.75) < 0.03);
  logs.sort((x, y) => x - y);
  assert.ok(Math.abs(logs[2000] - 4) < 0.3);
  assert.equal(r.weighted(['x', 'y'], [0, 1]), 'y');
  assert.equal(r.weighted([['x', 1], ['y', 0]]), 'x');
  const arr = [1, 2, 3, 4, 5];
  assert.deepEqual(r.shuffle(arr).sort(), arr);
  assert.deepEqual(arr, [1, 2, 3, 4, 5]);
});

test('calendar: working days, holidays and the demo dates of spec S14', () => {
  const cal = makeCalendar(canon.meta);
  assert.equal(dow('2026-11-10'), 2);
  assert.equal(weekStart('2026-02-10'), '2026-02-09');
  assert.equal(cal.isWd('2026-11-11'), true); // Veterans Day worked
  assert.equal(cal.isWd('2026-11-26'), false);
  assert.equal(cal.isWd('2026-07-03'), false);
  assert.equal(cal.isWd('2026-06-19'), true);
  assert.equal(cal.dayActivity('2026-06-19'), 0.5);
  const day = (n) => cal.addWd('2026-11-10', n);
  assert.deepEqual([5, 7, 8, 10, 11, 12, 13, 15].map(day),
    ['2026-11-17', '2026-11-19', '2026-11-20', '2026-11-24', '2026-11-25', '2026-11-30', '2026-12-01', '2026-12-03']);
  assert.equal(cal.addWd('2026-11-24', 3), '2026-12-01'); // case A standard
  assert.equal(cal.addWd('2026-11-20', 3), '2026-11-25'); // case A expedite
  assert.equal(cal.wdBetween('2026-11-10', '2026-12-01'), 13);
  assert.equal(cal.wdBetween('2026-12-01', '2026-11-10'), -13);
  assert.equal(cal.addWd('2026-12-01', -13), '2026-11-10');
  assert.equal(cal.addWd('2026-11-14', 0), '2026-11-16');
  assert.equal(cal.weekStarts[0], '2026-02-09');
  assert.equal(cal.weekStarts.length, 40);
  assert.equal(addDays('2026-02-28', 1), '2026-03-01');
});

test('calendar: Pacific offsets and sampled times are valid', () => {
  assert.equal(atLocal('2026-03-07', '09:00'), '2026-03-07T09:00:00-08:00');
  assert.equal(atLocal('2026-03-09', '09:00'), '2026-03-09T09:00:00-07:00');
  assert.equal(atLocal('2026-11-02', '09:00:05'), '2026-11-02T09:00:05-08:00');
  assert.equal(addMinutes('2026-03-07T23:30:00-08:00', 60 * 30), '2026-03-09T06:30:00-07:00');
  const cal = makeCalendar(canon.meta);
  const r = makeRng(3);
  for (let i = 0; i < 500; i++) {
    const d = cal.addWd('2026-02-10', i % 180);
    const t = cal.sampleTime(r, d);
    assert.equal(checkTime(t), null);
    assert.equal(localDate(t), d);
    const h = +t.slice(11, 13);
    assert.ok(h >= 6 && h < 23);
  }
});

test('calendar: week kinds from canon build milestones', () => {
  const cal = makeCalendar(canon.meta);
  const weeks = cal.buildWeeks(canon.milestones);
  assert.equal(weeks.filter((w) => w.kind === 'burst').length, 11);
  assert.equal(cal.weekKind('2026-10-27'), 'burst');
  assert.equal(cal.weekKind('2026-06-30'), 'quiet');
});

test('io: writeJson rounds money and scores, is stable, ends with a newline', () => {
  const dir = mkdtempSync(join(tmpdir(), 'burn-io-'));
  const p = join(dir, 'a', 'x.json');
  const v = { total_usd: 12.345678, score: 0.123456, n: 3, list: [{ amount_usd: 1.005 }] };
  writeJson(p, v);
  const text = readFileSync(p, 'utf8');
  assert.ok(text.endsWith('}\n'));
  assert.deepEqual(readJson(p), { total_usd: 12.35, score: 0.123, n: 3, list: [{ amount_usd: 1.01 }] });
  assert.equal(text, stringify(v));
  assert.equal(sha256(text), sha256(stringify(v)));
  assert.deepEqual(sortById([{ id: 'b' }, { id: 'a' }, { id: 'B' }]).map((x) => x.id), ['B', 'a', 'b']);
});
