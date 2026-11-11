// Seeded random numbers. Never Math.random.
//
//   const rng = makeRng(20261110);
//   const r = rng.fork('decide:o-0042');   // independent stream: depends only on (seed, label path)
//   r.float()                 uniform in [0, 1)
//   r.uniform(a, b)           uniform in [a, b)
//   r.int(a, b)               integer in [a, b], both inclusive
//   r.chance(p)               true with probability p
//   r.pick(array)             one element
//   r.weighted({a: 2, b: 1})  key of an object of weights
//   r.weighted(items, weights) / r.weighted([[item, w], ...])
//   r.normal(mean = 0, sd = 1)
//   r.lognormal(median, sigma)
//   r.poisson(lambda)
//   r.shuffle(array)          new shuffled array (input untouched)
//   r.sample(array, n)        n distinct elements, in shuffled order
//   r.id(n)                   n-digit numeric string
//
// fork(label) does not consume from the parent, so adding a draw in one stage never shifts another.

function hashString(str) {
  // xmur3
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^= h >>> 16) >>> 0;
  };
}

function sfc32(a, b, c, d) {
  return () => {
    a |= 0; b |= 0; c |= 0; d |= 0;
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
}

function make(path) {
  const h = hashString(path);
  const next = sfc32(h(), h(), h(), h());
  for (let i = 0; i < 12; i++) next();
  const rng = {
    path,
    fork: (label) => make(`${path}/${label}`),
    float: () => next(),
    uniform: (a, b) => a + (b - a) * next(),
    int: (a, b) => {
      const lo = Math.ceil(Math.min(a, b));
      const hi = Math.floor(Math.max(a, b));
      return lo + Math.floor(next() * (hi - lo + 1));
    },
    chance: (p) => next() < p,
    pick: (arr) => (arr.length ? arr[Math.floor(next() * arr.length)] : undefined),
    weighted: (items, weights) => {
      let keys;
      let ws;
      if (Array.isArray(items)) {
        if (weights) { keys = items; ws = weights; } else { keys = items.map((x) => x[0]); ws = items.map((x) => x[1]); }
      } else {
        keys = Object.keys(items);
        ws = keys.map((k) => items[k]);
      }
      let total = 0;
      for (const w of ws) total += Math.max(0, +w || 0);
      if (!(total > 0)) return keys[Math.floor(next() * keys.length)];
      let x = next() * total;
      for (let i = 0; i < keys.length; i++) {
        x -= Math.max(0, +ws[i] || 0);
        if (x < 0) return keys[i];
      }
      return keys[keys.length - 1];
    },
    normal: (mean = 0, sd = 1) => {
      const u = 1 - next();
      const v = next();
      return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    },
    lognormal: (median = 1, sigma = 0.5) => median * Math.exp(rng.normal(0, sigma)),
    poisson: (lambda) => {
      if (!(lambda > 0)) return 0;
      if (lambda > 60) return Math.max(0, Math.round(rng.normal(lambda, Math.sqrt(lambda))));
      const limit = Math.exp(-lambda);
      let k = 0;
      let p = 1;
      do { k++; p *= next(); } while (p > limit);
      return k - 1;
    },
    shuffle: (arr) => {
      const a = arr.slice();
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a;
    },
    sample: (arr, n) => rng.shuffle(arr).slice(0, Math.max(0, n)),
    id: (n) => {
      let s = String(1 + Math.floor(next() * 9));
      while (s.length < n) s += String(Math.floor(next() * 10));
      return s;
    },
  };
  return rng;
}

export function makeRng(seed) {
  return make(`seed:${seed}`);
}
