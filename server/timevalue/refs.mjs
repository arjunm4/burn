// Reference resolution: finds the company's parts, deliverables, tests, milestones, rigs and work items in text.
//
//   makeResolver(settings, opts?) -> resolve(text, ctx?) -> [{id, kind, mode, token, start, end, ambiguous?, order?}]
//
// kind: part | deliverable | test | milestone | rig | work
// mode: "id"    part number, Xometry quote or order number
//       "alias" a name or alias from settings (ambiguous aliases return every candidate with ambiguous: true)
//       "vague" "the bracket" / "the test": resolved only when exactly one candidate is left in the context
//
// opts:  { xometry: {quotes, orders}, calendar: [...], channelAssemblies: {<container>: [assembly ids]} }
// ctx:   { container, at, recent? }  recent = ids named shortly before in the same thread/channel;  container = Slack channel id / Jira key / meeting file; at = ISO time of the doc
//
// Work items are not configured in settings; they are discovered from text written as "<Activity>: <part name>"
// (e.g. "Rig setup: Spin-test adapter, knee actuator") and get the id `wk:<slug>`.

const KIND_WORDS = {
  test: ['test'], milestone: ['milestone', 'gate', 'build review'], rig: ['rig', 'stand', 'gantry', 'fixture', 'bench', 'dyno', 'chamber', 'cage'],
  deliverable: ['motor', 'firmware', 'board', 'pcb', 'pcba', 'sensor', 'cells', 'harness', 'driver'],
};
const STOP_VAGUE = new Set(['same', 'one', 'other', 'thing', 'way', 'week', 'day', 'vendor', 'team', 'plan', 'date', 'call', 'meeting', 'end', 'rest', 'time',
  'issue', 'thread', 'ticket', 'channel', 'doc', 'list', 'number', 'numbers', 'first', 'last', 'next', 'moment', 'quote', 'shop', 'lab', 'build',
  'part', 'order', 'stuff', 'update', 'eta', 'schedule', 'slot', 'fit check', 'actuator']);

export function slug(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }
export function workId(name) { return 'wk:' + slug(name); }
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const norm = (s) => String(s).toLowerCase().replace(/\s+/g, ' ').trim();

export function makeResolver(settings, opts = {}) {
  const entries = new Map(); // token(lower) -> [{id, kind, mode, order?}]
  const items = new Map();   // id -> {id, kind, name, assembly, assemblies}
  const add = (token, e) => {
    const k = norm(token); if (!k || k.length < 2) return;
    const list = entries.get(k) || []; if (!list.some((x) => x.id === e.id && x.mode === e.mode)) list.push(e); entries.set(k, list);
  };
  const vagueAliases = new Map(); // "the bracket" -> [ids]
  const addItem = (x, kind, assembly, extra = {}) => {
    items.set(x.id, { id: x.id, kind, name: x.name, assembly: assembly || null, ...extra });
    if (x.name) add(x.name, { id: x.id, kind, mode: 'alias' });
    for (const a of x.aliases || []) {
      if (/^(the|that|this) /i.test(a)) { const l = vagueAliases.get(norm(a)) || []; l.push(x.id); vagueAliases.set(norm(a), l); }
      else add(a, { id: x.id, kind, mode: 'alias' });
    }
  };
  for (const p of settings.parts || []) {
    addItem(p, 'part', p.assembly, { part_number: p.part_number });
    if (p.part_number) add(p.part_number, { id: p.id, kind: 'part', mode: 'id' });
  }
  for (const d of settings.deliverables || []) addItem(d, 'deliverable', d.assembly, { owner: d.owner });
  for (const t of settings.tests || []) addItem(t, 'test', t.assembly, { owner: t.owner, milestone: t.milestone, rig: t.rig });
  for (const m of settings.milestones || []) addItem(m, 'milestone', null, { assemblies: m.assemblies || [], owner: m.owner });
  for (const r of settings.rigs || []) addItem(r, 'rig', null, { owner: r.owner });
  // Tests have no aliases in settings: also match shortened names ("Hip actuator DVT spin test" -> "DVT spin test",
  // "spin test") when the shortened name is unique among all items and still ends in the test word.
  const shortCount = new Map();
  const shorts = [];
  for (const t of settings.tests || []) {
    const w = String(t.name).split(/\s+/);
    for (let k = 1; k <= w.length - 2; k++) { const sh = norm(w.slice(k).join(' ')); shorts.push([sh, t.id]); shortCount.set(sh, (shortCount.get(sh) || 0) + 1); }
  }
  for (const [sh, id] of shorts) if (shortCount.get(sh) === 1 && !entries.has(sh) && /\btest$/.test(sh) && sh.split(' ').length >= 2) add(sh, { id, kind: 'test', mode: 'alias' });
  const pnToPart = new Map((settings.parts || []).map((p) => [p.part_number, p.id]));
  const xo = opts.xometry || {};
  for (const o of [...(xo.quotes || []), ...(xo.orders || [])]) {
    const lines = o.line_items || o.parts || [];
    for (const num of [o.order_number, o.quote_id].filter(Boolean)) {
      for (const li of lines) { const pid = pnToPart.get(li.part_number); if (pid) add(num, { id: pid, kind: 'part', mode: 'id', order: num }); }
    }
  }
  // Longest token first so "Hip actuator DVT spin test complete" beats "Hip actuator DVT spin test".
  const tokens = [...entries.keys()].sort((a, b) => b.length - a.length);
  const big = tokens.length ? new RegExp(`(?<![\\w-])(?:${tokens.map(esc).join('|')})(?![\\w-]|/\\d)`, 'gi') : null;

  // Assemblies per container: explicit map, Jira project, or settings channel ids.
  const projAsm = new Map();
  for (const a of settings.assemblies || []) if (a.jira_project) projAsm.set(a.jira_project, [...(projAsm.get(a.jira_project) || []), a.id]);
  const chanAsm = new Map();
  for (const a of settings.assemblies || []) if (a.slack_channel) chanAsm.set(a.slack_channel, [...(chanAsm.get(a.slack_channel) || []), a.id]);
  const containerAssemblies = (c) => {
    if (!c) return [];
    if (opts.channelAssemblies && opts.channelAssemblies[c]) return opts.channelAssemblies[c];
    if (chanAsm.has(c)) return chanAsm.get(c);
    const m = String(c).match(/^([A-Z][A-Z0-9]+)-\d+$/); if (m && projAsm.has(m[1])) return projAsm.get(m[1]);
    return [];
  };
  // A test is "finished" at time T if a calendar booking for it ended before T.
  const testEnds = new Map();
  for (const ev of opts.calendar || []) {
    const b = parseBooking(ev.summary); if (!b) continue;
    const t = [...items.values()].find((x) => x.kind === 'test' && norm(x.name) === norm(b.test));
    if (t && ev.end) testEnds.set(t.id, [...(testEnds.get(t.id) || []), ev.end]);
  }
  const asmOf = (id) => { const x = items.get(id); return x ? (x.assemblies && x.assemblies.length ? x.assemblies : x.assembly ? [x.assembly] : []) : []; };

  function resolve(text, ctx = {}) {
    const out = [];
    const taken = [];
    const ctxAsm = new Set(containerAssemblies(ctx.container));
    const free = (s, e) => !taken.some(([a, b]) => s < b && e > a);
    if (big && text) {
      for (const m of text.matchAll(big)) {
        const s = m.index, e = s + m[0].length; if (!free(s, e)) continue;
        // Bare numbers ("1042") only count as part aliases when not a quantity, date or money.
        if (/^\d+$/.test(m[0]) && (/[$#/]$/.test(text.slice(0, s)) || /^(?:x\b|\s*x\s|\s*(?:days?|pcs|units|mm|in|%))/i.test(text.slice(e)) || /\d\/$/.test(text.slice(0, s)))) continue;
        let cands = entries.get(norm(m[0]));
        // Purely numeric aliases ("1290") count only in a container owned by that part's assembly.
        if (/^\d+$/.test(m[0])) { cands = cands.filter((c) => c.mode === 'id' || asmOf(c.id).some((a) => ctxAsm.has(a))); if (!cands.length) continue; }
        taken.push([s, e]);
        for (const c of cands) out.push({ ...c, token: m[0], start: s, end: e, ...(cands.length > 1 ? { ambiguous: true } : {}) });
      }
    }
    // Work items: "<Activity>: <known part / deliverable name>".
    for (const m of (text || '').matchAll(/(?:^|[(\n]|\.\s)\s*([A-Z][A-Za-z0-9/+&'-]*(?: [A-Za-z0-9/+&'(),-]+?){0,6}): ([^():\n]+?)(?=\)|$|\n|\.(?:\s|$))/g)) {
      const obj = norm(m[2]);
      const target = (entries.get(obj) || []).find((x) => x.mode === 'alias' && items.get(x.id) && norm(items.get(x.id).name) === obj && (x.kind === 'part' || x.kind === 'deliverable'));
      if (!target) continue;
      const name = `${m[1]}: ${m[2]}`;
      const s = m.index + m[0].indexOf(m[1]), e = s + name.length;
      // the object name inside is the work item's object, not a separate mention
      for (let i = out.length - 1; i >= 0; i--) if (out[i].start >= s && out[i].end <= e) out.splice(i, 1);
      for (let i = taken.length - 1; i >= 0; i--) if (taken[i][0] >= s && taken[i][1] <= e) taken.splice(i, 1);
      taken.push([s, e]);
      const asm = items.get(target.id)?.assembly || null;
      out.push({ id: workId(name), kind: 'work', mode: 'alias', token: name, start: s, end: e, name, object: target.id, assembly: asm });
    }
    // Vague phrases.
    const coAsm = new Set(out.filter((r) => !r.ambiguous).flatMap((r) => (r.assembly ? [r.assembly] : asmOf(r.id))));
    const inAsm = (x, set) => (x.assemblies && x.assemblies.length ? x.assemblies : x.assembly ? [x.assembly] : []).some((a) => set.has(a));
    const candidatesFor = (phrase, head) => {
      if (vagueAliases.has(phrase)) return vagueAliases.get(phrase).map((id) => items.get(id));
      const last = head.split(' ').pop();
      const kind = Object.keys(KIND_WORDS).find((k) => KIND_WORDS[k].includes(last));
      const has = (x) => new RegExp(`\\b${esc(head)}s?\\b`).test(norm(x.name).replace(/-/g, ' '));
      return [...items.values()].filter((x) => x.kind !== 'work' && ((kind && x.kind === kind && (head === last && kind === 'test' ? true : has(x))) || (!kind && x.kind === 'part' && has(x))));
    };
    for (const m of (text || '').matchAll(/\b(?:the|that|this|those|these)\s+([a-z][a-z-]*)(?:\s+([a-z][a-z-]*))?(?:\s+([a-z][a-z-]*))?/gi)) {
      const words = [m[1], m[2], m[3]].filter(Boolean).map((w) => w.toLowerCase());
      for (let n = words.length; n >= 1; n--) {
        const head = words.slice(0, n).join(' ').replace(/s$/, '');
        if (STOP_VAGUE.has(head) || STOP_VAGUE.has(words[n - 1])) continue;
        const phraseText = m[0].split(/\s+/).slice(0, n + 1).join(' ');
        const s = m.index, e = s + phraseText.length; if (!free(s, e)) break;
        const cands = candidatesFor(norm(phraseText), head);
        if (!cands.length) continue;
        let pool = ctxAsm.size ? cands.filter((x) => inAsm(x, ctxAsm)) : cands;
        if (pool.length > 1 && coAsm.size) { const p2 = pool.filter((x) => inAsm(x, coAsm)); if (p2.length) pool = p2; }
        if (pool.length > 1 && ctx.at) pool = pool.filter((x) => x.kind !== 'test' || !testEnds.has(x.id) || !testEnds.get(x.id).every((end) => Date.parse(end) < Date.parse(ctx.at)));
        // Discourse: something of that kind named in the same thread or channel shortly before (ctx.recent = [ids]).
        if (pool.length !== 1 && ctx.recent && ctx.recent.length) { const p3 = (pool.length ? pool : cands).filter((x) => ctx.recent.includes(x.id)); if (p3.length === 1) pool = p3; else if (p3.length > 1) { const last = ctx.recent.slice().reverse().find((id) => p3.some((x) => x.id === id)); pool = p3.filter((x) => x.id === last); } }
        if (!ctxAsm.size && !coAsm.size && cands.length !== 1 && !(ctx.recent && pool.length === 1 && ctx.recent.includes(pool[0].id))) break; // vague needs a context unless unique company-wide
        if (pool.length === 1) { taken.push([s, e]); out.push({ id: pool[0].id, kind: pool[0].kind, mode: 'vague', token: phraseText, start: s, end: e }); }
        break;
      }
    }
    return out.sort((a, b) => a.start - b.start || (a.id < b.id ? -1 : 1));
  }
  resolve.items = items;
  resolve.people = settings.people || [];
  resolve.containerAssemblies = containerAssemblies;
  resolve.byName = (name) => { const l = entries.get(norm(name)); return l ? l.filter((x) => x.mode === 'alias') : []; };
  return resolve;
}

// "Spin-test stand: Hip actuator DVT spin test (Arjun) - tentative" -> {rig, test, who, tentative}
export function parseBooking(summary) {
  const m = String(summary || '').match(/^(.+?): (.+?)(?: \(([^)]+)\))?(?: - (tentative|confirmed|cancelled))?$/i);
  if (!m) return null;
  return { rig: m[1].trim(), test: m[2].trim(), who: m[3] || null, status: (m[4] || 'confirmed').toLowerCase() };
}
