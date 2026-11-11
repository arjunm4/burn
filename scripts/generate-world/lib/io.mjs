// JSON in and out, byte-stable.
//
//   readJson(path)              parse a JSON file
//   writeJson(path, value)      2-space indent, final newline; money (keys ending _usd, or named amount/price)
//                               rounded to cents, every other non-integer number to 3 dp; creates directories
//   stringify(value)            the exact text writeJson writes
//   roundMoney(x), round3(x)
//   sortById(array)             new array sorted by id (plain code-unit order, not locale)
//   sortByTime(array, key = 'known_at')   new array sorted by (time, id)
//   cmp(a, b)                   locale-free string/number comparison
//   sha256(text)                hex digest
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';

export function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function roundMoney(x) { return Math.round((x + Number.EPSILON) * 100) / 100; }
export function round3(x) { return Math.round(x * 1000) / 1000; }

const MONEY_KEY = /(_usd|^amount|^price|_price|_amount)$/;

export function stringify(value) {
  return JSON.stringify(value, function replacer(key, v) {
    if (typeof v === 'number' && !Number.isInteger(v)) {
      if (!Number.isFinite(v)) return null;
      return MONEY_KEY.test(key) ? roundMoney(v) : round3(v);
    }
    return v;
  }, 2) + '\n';
}

export function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const text = stringify(value);
  writeFileSync(path, text);
  return text;
}

export function cmp(a, b) { return a < b ? -1 : a > b ? 1 : 0; }

export function sortById(arr) {
  return arr.slice().sort((a, b) => cmp(a.id, b.id));
}

export function sortByTime(arr, key = 'known_at') {
  return arr.slice().sort((a, b) => cmp(Date.parse(a[key]), Date.parse(b[key])) || cmp(a.id, b.id));
}

export function sha256(text) {
  return createHash('sha256').update(text).digest('hex');
}
