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

function slug(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }
export function workId(name) { return 'wk:' + slug(name); }
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const norm = (s) => String(s).toLowerCase().replace(/\s+/g, ' ').trim();

export function makeResolver(settings, opts = {}) {
  settings = settings || {};
  opts = opts || {};
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
  // Deliverables are written short: "DVT hip frameless motor" -> "hip motor", "dvt motor", "frameless motor".
  // "<one word of the name> <its head word>" when the head is a deliverable kind word; several deliverables can share
  // one ("hip motor": the EVT and the DVT motor), which phaseOf() settles by date below.
  const HEADS = new Set([...KIND_WORDS.deliverable, 'motors', 'boards', 'sensors', 'drivers']);
  const SKIP = new Set(['for', 'and', 'the', 'of', 'a', 'an', 'to', 'with', 'qty', 'set', 'kit', 'lot', 'sample', 'build']);
  const shortDl = new Map();
  for (const d of settings.deliverables || []) {
    const main = String(d.name || '').replace(/\s*\([^)]*\)/g, '').trim().toLowerCase();
    const w = main.split(/\s+/), head = w[w.length - 1];
    if (w.length < 3 || !HEADS.has(head)) continue;
    for (const x of w.slice(0, -1)) if (!SKIP.has(x) && !/^\d/.test(x)) { const k = `${x} ${head}`; shortDl.set(k, [...new Set([...(shortDl.get(k) || []), d.id])]); }
  }
  for (const [k, ids] of shortDl) if (!entries.has(k)) for (const id of ids) add(k, { id, kind: 'deliverable', mode: 'alias', short: true });
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
  // Work-item names: a sentence-case activity, optionally "for <test or milestone>", then ": <object name>".
  const objList = [...(settings.parts || []), ...(settings.deliverables || []), ...(settings.rigs || [])].filter((x) => x.name);
  const useList = [...(settings.tests || []), ...(settings.milestones || [])].filter((x) => x.name);
  const objByName = new Map(objList.map((x) => [norm(x.name), x.id]));
  const useByName = new Map(useList.map((x) => [norm(x.name), x.id]));
  // Names as written (case-sensitive, so the sentence-case activity test means something); first letter either case.
  const alt = (list) => [...new Set(list.map((x) => x.name.trim()))].sort((a, b) => b.length - a.length)
    .map((n) => `[${n[0].toUpperCase()}${n[0].toLowerCase()}]` + esc(n.slice(1)).replace(/ +/g, '\\s+')).join('|');
  const LEAD = '(?!(?:Then|Also|And|So|Plus|Next|Still|Need|Needs|Re|Fyi|For|The|Same|Correction|Bumping|Reposting|Scratch|Note|Update|Status|Date|Ok|Okay|Yes|No|Just)\\b)';
  const ACT = `${LEAD}[A-Z][a-z]+(?:[-/][a-z]+)?(?: [a-z]+(?:[-/][a-z]+)?){0,4}`;
  const workRe = objByName.size ? new RegExp(`(?<![\\w-])(${ACT})(?: for (${alt(useList)}))?: (${alt(objList)})(?![\\w-])`, 'g') : null;

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

  // Items that differ only by build phase (EVT / DVT / PVT): the phase still being worked toward at `at` (its last
  // milestone for the item's assembly is not past yet), else the latest phase. Unsettled -> all candidates (ambiguous).
  const PHASES = ['proto', 'evt', 'dvt', 'pvt'];
  const phaseOf = (id) => { const n = String(items.get(id)?.name || '').toLowerCase(); return PHASES.find((p) => new RegExp(`\\b${p}\\b`).test(n)) || null; };
  const phaseEnd = (phase, asm) => {
    let end = null;
    for (const m of settings.milestones || []) {
      if (!new RegExp(`\\b${phase}\\b`, 'i').test(m.name) || (asm && m.assemblies && !m.assemblies.includes(asm))) continue;
      const v = (m.date || []).at(-1)?.value; if (v && (!end || v > end)) end = v;
    }
    return end;
  };
  function pickPhase(cands, at) {
    const ph = cands.map((c) => phaseOf(c.id));
    if (ph.some((p) => !p) || new Set(ph).size !== ph.length) return cands;
    const day = at ? String(at).slice(0, 10) : null;
    const order = cands.map((c, i) => ({ c, rank: PHASES.indexOf(ph[i]), end: phaseEnd(ph[i], items.get(c.id)?.assembly) })).sort((a, b) => a.rank - b.rank);
    const open = day ? order.find((x) => x.end && x.end >= day) : null;
    return [(open || order[order.length - 1]).c];
  }

  function resolve(text, ctx = {}) {
    text = text == null ? '' : String(text);
    ctx = ctx || {};
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
        if (cands.length > 1 && cands.every((c) => c.short)) cands = pickPhase(cands, ctx.at);
        // Purely numeric aliases ("1290") count only in a container owned by that part's assembly.
        if (/^\d+$/.test(m[0])) { cands = cands.filter((c) => c.mode === 'id' || asmOf(c.id).some((a) => ctxAsm.has(a))); if (!cands.length) continue; }
        taken.push([s, e]);
        for (const c of cands) out.push({ ...c, token: m[0], start: s, end: e, ...(cands.length > 1 ? { ambiguous: true } : {}) });
      }
    }
    // Work items: "<Activity>[ for <test / milestone name>]: <part / deliverable / rig name>", anywhere in a sentence
    // ("need 3 by 11/10 for Rig setup for Hip actuator dyno efficiency sweep: Dyno shaft spacer, plus ...").
    for (const m of (text && workRe ? text.matchAll(workRe) : [])) {
      const target = { id: objByName.get(norm(m[3])) };
      if (!target.id) continue;
      const name = m[0].replace(/\s+/g, ' ');
      const s = m.index, e = s + m[0].length;
      // the object name inside is the work item's object, not a separate mention
      for (let i = out.length - 1; i >= 0; i--) if (out[i].start >= s && out[i].end <= e) out.splice(i, 1);
      for (let i = taken.length - 1; i >= 0; i--) if (taken[i][0] >= s && taken[i][1] <= e) taken.splice(i, 1);
      taken.push([s, e]);
      const asm = items.get(target.id)?.assembly || null;
      const use = m[2] ? useByName.get(norm(m[2])) || null : null;
      out.push({ id: workId(name), kind: 'work', mode: 'alias', token: name, start: s, end: e, name, object: target.id, use, assembly: asm });
    }
    // Vague phrases.
    const coAsm = new Set(out.filter((r) => !r.ambiguous).flatMap((r) => (r.assembly ? [r.assembly] : asmOf(r.id))));
    const inAsm = (x, set) => asmOf(x.id).some((a) => set.has(a));
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
  resolve.assembliesOf = asmOf;
  return resolve;
}

// "Spin-test stand: Hip actuator DVT spin test (Arjun) - tentative" -> {rig, test, who, tentative}
export function parseBooking(summary) {
  const m = String(summary || '').match(/^(.+?): (.+?)(?: \(([^)]+)\))?(?: - (tentative|confirmed|cancelled))?$/i);
  if (!m) return null;
  return { rig: m[1].trim(), test: m[2].trim(), who: m[3] || null, status: (m[4] || 'confirmed').toLowerCase() };
}
