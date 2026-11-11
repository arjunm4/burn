import React from 'react';
import { makeCalendar, addDays, toDate, dow } from './calendar.mjs';
import { solve } from './solve.mjs';
import { holidays as HOLIDAYS } from '../../fixtures/timevalue/settings.json';

// The "why" of a Time Value card: a working-day dependency timeline.
// Rows: the bracket (one bar per quote tier), the other input (the motor), the test, the milestone.
// Every date comes from the card; test runs are re-solved with solve() so a chosen tier moves the test.
// Geometry is tweened between renders (and across the card's remount on a tab change) so bars glide.

const W = 1000;          // viewBox width; the svg scales to the card
const X0 = 232;          // left label column
const PADR = 16;
const AX = 50;           // axis header height
const LANE = 22;         // bracket lane pitch
const TLANE = 34;        // test lane pitch
const WD2 = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const day = (d) => { const x = new Date(d + 'T00:00:00Z'); return `${WD[x.getUTCDay()]} ${x.getUTCMonth() + 1}/${x.getUTCDate()}`; };
const money = (n) => '$' + Math.round(n).toLocaleString('en-US');
const pl = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const first = (name) => String(name || '').split(' ')[0];
const halo = { paintOrder: 'stroke', stroke: '#fff', strokeWidth: 4, strokeLinejoin: 'round' };
const textW = (s, px) => String(s).length * px * 0.56;

// "Sun 11/8" from a Slack ts (seconds) read in Pacific time; null when it is not one.
function slackDay(docId) {
  const m = /^slack:[^:]+:(\d+)/.exec(String(docId || ''));
  if (!m) return null;
  return day(new Date(Number(m[1]) * 1000 - 8 * 3600e3).toISOString().slice(0, 10));
}

// The motor scenarios the card carries: one date, a {min,max} range, or two sources that disagree.
function motorScenarios(card) {
  const inp = card.inputs?.[0];
  if (!inp) return { inp: null, mode: 'none', list: [{ key: 's0', date: null }] };
  const base = { who: inp.said_by, ago: inp.said_ago, doc: inp.doc_id };
  if (inp.ready && typeof inp.ready === 'object') {
    const min = toDate(inp.ready.min); const max = toDate(inp.ready.max);
    return { inp, mode: 'range', list: [
      { key: 's0', date: min, lane: `if ${day(min)}`, ...base },
      { key: 's1', date: max, lane: `if ${day(max)}`, ...base },
    ] };
  }
  const conflict = (card.checks || []).flatMap((k) => k.items || []).find((i) => i.key === 'conflict');
  if (conflict) {
    const pairs = [...String(conflict.text).matchAll(/(\d{4}-\d{2}-\d{2}) \(([^)]+)\)/g)].map((m) => ({ date: m[1], who: m[2] }));
    if (pairs.length >= 2) {
      const list = pairs.slice(0, 2).map((p) => {
        const mine = p.who === inp.said_by && p.date === toDate(inp.ready);
        const doc = mine ? inp.doc_id : (conflict.sources || []).find((s) => s !== inp.doc_id) || null;
        return { date: p.date, who: p.who, ago: mine ? inp.said_ago : slackDay(doc), doc };
      }).sort((a, b) => (a.date < b.date ? -1 : 1))
        .map((s, i) => ({ ...s, key: `s${i}`, lane: `if ${first(s.who)} (${day(s.date).slice(4)})` }));
      return { inp, mode: 'conflict', list };
    }
  }
  return { inp, mode: 'single', list: [{ key: 's0', date: toDate(inp.ready), ...base }] };
}

export function buildScene(card, tierKey, { C, sourceLabel = (s) => s }) {
  const cal = makeCalendar(HOLIDAYS);
  const now = toDate(card.now);
  const hm = /T(\d\d):(\d\d)/.exec(card.now || '');
  const nowFrac = hm ? (Number(hm[1]) + Number(hm[2]) / 60) / 24 : 0;
  const tiers = [...(card.tiers || [])].sort((a, b) => a.total - b.total);
  const cheapest = tiers[0];
  const sel = tiers.find((t) => t.tier === tierKey) || cheapest;
  const motor = motorScenarios(card);
  const test = { id: card.test?.id, duration_days: card.test?.duration_days, planned_start: card.test?.planned_start, owner: card.test?.owner };
  const target = toDate(card.milestone?.target);

  // Solve every (scenario, tier) pair.
  const runs = motor.list.map((s) => Object.fromEntries(tiers.map((t) => {
    const inputs = [{ id: 'part', ready: t.ready }, ...(s.date ? [{ id: 'motor', ready: s.date }] : [])];
    return [t.tier, solve({ cal, test, inputs })];
  })));

  // Axis: working-day calendar from today to at least 24 days out, covering every date drawn.
  const dates = [now, addDays(now, 24), target, ...tiers.map((t) => t.ready), ...motor.list.map((s) => s.date),
    ...runs.flatMap((r) => Object.values(r).map((x) => x.finish))].filter(Boolean).sort();
  const end = dates[dates.length - 1] > addDays(now, 24) ? addDays(dates[dates.length - 1], 1) : addDays(now, 24);
  const days = []; for (let d = now; d <= end; d = addDays(d, 1)) days.push(d);
  const dw = (W - X0 - PADR) / days.length;
  const xs = (d) => X0 + days.indexOf(d) * dw;
  const xe = (d) => xs(d) + dw;
  const nowX = xs(now) + nowFrac * dw;

  // Rows.
  const nS = motor.list.length;
  const rows = {};
  let y = AX + 6;
  rows.bracket = { y, h: 14 + tiers.length * LANE }; y += rows.bracket.h;
  rows.motor = { y, h: motor.mode === 'conflict' ? 66 : 58 }; y += rows.motor.h;
  rows.test = { y, h: 14 + nS * TLANE }; y += rows.test.h;
  rows.mile = { y, h: 54 }; y += rows.mile.h;
  const H = y + 18;
  const laneY = (i) => rows.bracket.y + 14 + i * LANE;
  const tLaneY = (i) => rows.test.y + 22 + i * TLANE;
  const motorY = rows.motor.y + rows.motor.h / 2 + (motor.mode === 'conflict' ? 8 : 0);
  const mileY = rows.mile.y + 22;

  const items = [];
  const add = (it) => { items.push(it); return it; };
  const srcLine = (who, ago, doc) => [who && `${first(who)}, ${ago || 'earlier'}`, doc && sourceLabel(doc)].filter(Boolean).join(' · ');

  // Shading for non-working days and the today line.
  const off = days.filter((d) => !cal.isWd(d));
  for (const d of off) add({ id: `sh:${d}`, k: 'rect', n: { x: xs(d), y: AX - 2, w: dw, h: H - AX - 16 }, fill: C.paper, o: 1, under: true });
  const hol = days.filter((d) => dow(d) !== 0 && dow(d) !== 6 && !cal.isWd(d));
  const holGroups = [];
  for (const d of hol) { const g = holGroups[holGroups.length - 1]; if (g && addDays(g[g.length - 1], 1) === d) g.push(d); else holGroups.push([d]); }

  // Test-row weekend mask: drawn over the test bars so a run visibly skips days off.
  for (const d of off) add({ id: `mk:${d}`, k: 'rect', n: { x: xs(d), y: rows.test.y + 4, w: dw, h: rows.test.h - 8 }, fill: C.paper, layer: 'mask' });

  // Bracket lanes.
  const s0run = runs[0];
  const selRun0 = s0run[sel.tier];
  tiers.forEach((t, i) => {
    const on = t.tier === sel.tier;
    const ly = laneY(i);
    const r = s0run[t.tier];
    const quoted = `${t.label} · ${money(t.total)}${t.lead_days ? ` · ${t.lead_days} business days` : ''}`;
    const pop = { title: `Bracket, ${t.label}`, lines: [quoted, `Ready ${day(t.ready)} · usable ${day(cal.nextWd(t.ready))}`], source: `Xometry quote${card.quote?.id ? ` ${card.quote.id}` : ''}` };
    add({ id: `tb:${t.tier}`, k: 'rect', n: { x: nowX, y: ly - 4, w: Math.max(2, xe(t.ready) - nowX), h: 8, o: on ? 1 : 0.55 }, fill: on ? C.ink : C.faint, rx: 4, pop, tier: t.tier });
    add({ id: `tl:${t.tier}`, k: 'text', n: { x: xe(t.ready) + 6, y: ly + 4, o: 1 }, text: day(t.ready), size: 11, fill: on ? C.ink : C.muted, halo: true, weight: on ? 500 : 400 });
    // The days a part sits on the shelf before the test can start.
    if (r.start) {
      const waitFrom = xe(t.ready) + textW(day(t.ready), 11) + 12;
      const waitTo = xs(r.start) - 4;
      const idle = cal.wdBetween(t.ready, r.start) - 1;
      if (idle > 0 && waitTo - waitFrom > 8) {
        const cheaperSame = tiers.filter((u) => u.total < t.total && s0run[u.tier].finish && s0run[u.tier].finish <= r.finish);
        const wasted = cheaperSame.length ? t.total - Math.min(...cheaperSame.map((u) => u.total)) : 0;
        const dominated = !!t.no_faster_than;
        add({ id: `tw:${t.tier}`, k: 'line', n: { x1: waitFrom, y1: ly, x2: waitTo, y2: ly, o: on ? 1 : 0.7 }, stroke: dominated ? C.critical : on ? C.ink : C.faint, dash: '3 4', width: 1.25,
          pop: { title: `${t.label} waits`, lines: [`Ready ${day(t.ready)}, but the test cannot start until ${day(r.start)}.`, `Idle ${pl(idle, 'working day')}${wasted ? `; ${money(wasted)} buys nothing` : ''}.`], source: 'Schedule maths' } });
        if (on || dominated) {
          const label = `${wasted ? `+${money(wasted)}, ` : ''}waits ${pl(idle, 'day')}`;
          add({ id: `twl:${t.tier}`, k: 'text', n: { x: (waitFrom + waitTo) / 2, y: ly - 5, o: 1 }, text: label, size: 10.5, anchor: 'middle', fill: dominated && wasted ? C.critical : C.muted, halo: true });
        }
      }
    }
  });

  // Motor row.
  const inp = motor.inp;
  const runFor = (i) => runs[i][sel.tier];
  if (inp) {
    if (motor.mode === 'single') {
      const s = motor.list[0];
      add({ id: 'mb', k: 'rect', n: { x: nowX, y: motorY - 4, w: xe(s.date) - nowX, h: 8, o: 1 }, fill: C.ink, rx: 4,
        pop: { title: inp.name, lines: [`Ready ${day(s.date)} · usable ${day(cal.nextWd(s.date))}`], source: srcLine(s.who, s.ago, s.doc) } });
      add({ id: 'ml', k: 'text', n: { x: xe(s.date) + 6, y: motorY + 4, o: 1 }, text: day(s.date), size: 11, fill: C.ink, halo: true, weight: 500 });
    } else if (motor.mode === 'range') {
      const [a, b] = motor.list;
      const pop = { title: inp.name, lines: [`Ready ${inp.ready_text}`, 'The vendor will not commit to a date.'], source: srcLine(a.who, a.ago, a.doc) };
      add({ id: 'mb', k: 'rect', n: { x: nowX, y: motorY - 4, w: xs(a.date) - nowX, h: 8, o: 1 }, fill: C.ink, rx: 4, pop });
      add({ id: 'mr', k: 'rect', n: { x: xs(a.date), y: motorY - 9, w: xe(b.date) - xs(a.date), h: 18, o: 1 }, fill: 'url(#tv-hatch)', stroke: C.muted, rx: 3, pop, spawn: 'mb' });
      add({ id: 'mrl', k: 'text', n: { x: (xs(a.date) + xe(b.date)) / 2, y: motorY + 22, o: 1 }, text: `somewhere ${day(a.date)} – ${day(b.date)}`, size: 10.5, anchor: 'middle', fill: C.muted, halo: true });
    } else if (motor.mode === 'conflict') {
      const [a, b] = motor.list;
      add({ id: 'mb', k: 'rect', n: { x: nowX, y: motorY - 4, w: xe(a.date) - nowX, h: 8, o: 1 }, fill: C.faint, rx: 4,
        pop: { title: inp.name, lines: ['Two sources give different dates.'], source: 'Slack #actuators' } });
      add({ id: 'mgap', k: 'line', n: { x1: xe(a.date), y1: motorY, x2: xe(b.date), y2: motorY, o: 1 }, stroke: C.critical, dash: '4 3', width: 1.5 });
      add({ id: 'mgapl', k: 'text', n: { x: (xe(a.date) + xe(b.date)) / 2, y: motorY + 18, o: 1 }, text: 'sources disagree', size: 10.5, anchor: 'middle', fill: C.critical, halo: true });
      motor.list.forEach((s, i) => {
        const pop = { title: `${inp.name}, per ${first(s.who)}`, lines: [`Ready ${day(s.date)} · usable ${day(cal.nextWd(s.date))}`], source: srcLine(s.who, s.ago, s.doc) };
        add({ id: `mm:${i}`, k: 'circle', n: { cx: xe(s.date), cy: motorY, r: 6, o: 1 }, fill: '#fff', stroke: C.critical, width: 2, pop, spawn: 'ml' });
        add({ id: `mml:${i}`, k: 'text', n: { x: xe(s.date), y: motorY - 13, o: 1 }, text: `${first(s.who)} · ${day(s.date)}`, size: 11, anchor: 'middle', fill: C.ink, halo: true, weight: 500 });
      });
    }
  }

  // Switching line (uncertain motor): which tier pays, and by when.
  if (card.switching?.by_date && motor.mode === 'range') {
    const by = toDate(card.switching.by_date);
    const fast = tiers.filter((t) => t !== cheapest && runs[0][t.tier].finish < runs[0][cheapest.tier].finish)[0];
    const x = xe(by);
    add({ id: 'sw', k: 'line', n: { x1: x, y1: rows.motor.y + 6, x2: x, y2: rows.test.y + rows.test.h - 4, o: 1 }, stroke: C.ink, dash: '2 3', width: 1.25 });
    const label = `${fast ? fast.label : 'Paying'} pays only if ready by ${day(by)}`;
    add({ id: 'swl', k: 'pill', n: { x: x + 6, y: rows.motor.y + 2, o: 1 }, text: label, size: 10.5, fill: C.accent, color: C.ink });
  }

  // Test lanes: the chosen tier's run per scenario, a ghost of the comparison tier, and the gap between them.
  const fastest = [...tiers].sort((a, b) => (s0run[a.tier].finish || '9') < (s0run[b.tier].finish || '9') ? -1 : (s0run[a.tier].finish === s0run[b.tier].finish ? a.total - b.total : 1))[0];
  motor.list.forEach((s, i) => {
    const r = runFor(i);
    const ty = tLaneY(i);
    if (!r.start) return;
    const partUse = cal.nextWd(sel.ready);
    const motorUse = s.date ? cal.nextWd(s.date) : null;
    const latest = motorUse && motorUse >= partUse ? motorUse : partUse;
    const plan = toDate(test.planned_start);
    const planSets = plan && plan > latest;
    const motorCrit = !planSets && motorUse && motorUse >= partUse;
    const partCrit = !planSets && partUse >= (motorUse || '');
    s.crit = planSets ? 'planned start' : motorCrit && partCrit ? 'bracket and motor' : motorCrit ? (inp ? 'motor' : 'input') : 'bracket';
    add({ id: `tr:${i}`, k: 'rect', n: { x: xs(r.start), y: ty - 7, w: xe(r.finish) - xs(r.start), h: 14, o: 1 }, fill: C.ink, rx: 3, spawn: 'tr:0', layer: 'test',
      pop: { title: card.test?.name || 'Test', lines: [`${day(r.start)} → ${day(r.finish)} · ${pl(card.test?.duration_days, 'working day')}`, `${s.crit[0].toUpperCase() + s.crit.slice(1)} sets the start${plan ? ` · planned start ${day(plan)}` : ''}`, ...(s.lane ? [`Scenario: motor ${s.lane.slice(3)}`] : [])], source: `Owner ${first(card.test?.owner) || 'unknown'} · Calendar` } });
    if (s.lane) add({ id: `tsl:${i}`, k: 'text', n: { x: X0 - 10, y: ty + 4, o: 1 }, text: s.lane, size: 11, anchor: 'end', fill: C.muted });
    // Comparison: what the cheapest tier does (if a dearer tier is chosen) or what the fastest tier would save.
    const cmpT = sel !== cheapest ? cheapest : fastest;
    const c = runs[i][cmpT.tier];
    if (cmpT === sel && tiers.length > 1) {
      const lab = 'paying more finishes no sooner';
      add({ id: `tgl:${i}`, k: 'text', n: { x: Math.min(W - PADR - textW(lab, 10.5) / 2, (xs(r.start) + xe(r.finish)) / 2), y: ty - 15, o: 1 }, text: lab, size: 10.5, anchor: 'middle', fill: C.ink, halo: true, weight: 500 });
    }
    if (cmpT !== sel && c.finish) {
      const diff = cal.wdBetween(r.finish, c.finish); // > 0: chosen finishes sooner
      if (c.finish !== r.finish) add({ id: `tg:${i}`, k: 'rect', n: { x: xs(c.start), y: ty - 7, w: xe(c.finish) - xs(c.start), h: 14, o: 1 }, fill: 'none', stroke: C.muted, dash: '3 3', rx: 3, spawn: `tr:${i}`, layer: 'test' });
      let label = null;
      if (sel !== cheapest) label = diff > 0 ? `${pl(diff, 'working day')} saved vs ${cheapest.label}` : `same finish as ${cheapest.label}: buys no time`;
      else if (diff < 0) label = `${cmpT.label} would save ${pl(-diff, 'working day')}`;
      if (label) {
        const a = Math.min(xe(r.finish), xe(c.finish)); const b = Math.max(xe(r.finish), xe(c.finish));
        const tw = textW(label, 10.5);
        const cx = Math.min(W - PADR - tw / 2, Math.max((a + b) / 2, X0 + tw / 2));
        if (b > a) add({ id: `tgb:${i}`, k: 'bracket', n: { x1: a, x2: b, y: ty - 11, o: 1 }, stroke: diff > 0 ? C.ink : C.muted });
        add({ id: `tgl:${i}`, k: 'text', n: { x: cx, y: ty - 15, o: 1 }, text: label, size: 10.5, anchor: 'middle', fill: diff === 0 && sel !== cheapest ? C.critical : C.ink, halo: true, weight: 500 });
      }
    }
    // Edges into the test start.
    const tx = xs(r.start) - 2;
    const selIdx = tiers.indexOf(sel);
    add({ id: `eb:${i}`, k: 'edge', n: { x1: xe(sel.ready), y1: laneY(selIdx), x2: tx, y2: ty, o: 1 }, crit: partCrit,
      pop: { title: `Bracket → ${card.test?.name || 'test'}`, lines: [`${sel.label} ready ${day(sel.ready)}, usable ${day(partUse)}`, partCrit ? 'Sets the start (critical path)' : `Not the limiter: the ${s.crit} sets the start`], source: 'Xometry quote' } });
    if (s.date) {
      const mx = motor.mode === 'range' ? (i === 0 ? xs(s.date) + dw : xe(s.date)) : xe(s.date);
      add({ id: `em:${i}`, k: 'edge', n: { x1: mx, y1: motorY, x2: tx, y2: ty, o: 1 }, crit: motorCrit, spawn: 'em:0',
        pop: { title: `Motor → ${card.test?.name || 'test'}`, lines: [`Ready ${day(s.date)}, usable ${day(motorUse)}`, motorCrit ? 'Sets the start (critical path)' : 'Not the limiter'], source: srcLine(s.who, s.ago, s.doc) } });
    }
    // Drop line from the finish to the milestone row.
    add({ id: `td:${i}`, k: 'line', n: { x1: xe(r.finish), y1: ty + 7, x2: xe(r.finish), y2: mileY, o: 1 }, stroke: C.faint, dash: '2 3', width: 1 });
    add({ id: `fm:${i}`, k: 'circle', n: { cx: xe(r.finish), cy: mileY, r: 4.5, o: 1 }, fill: C.ink, stroke: '#fff', width: 1.5, spawn: 'fm:0',
      pop: { title: 'Test done', lines: [`${day(r.finish)}${s.lane ? ` (motor ${s.lane.slice(3)})` : ''}`, target ? (cal.wdBetween(target, r.finish) > 0 ? `${pl(cal.wdBetween(target, r.finish), 'working day')} after the target` : 'On or before the target') : ''].filter(Boolean), source: 'Schedule maths' } });
  });

  // Planned start marker.
  const plan = toDate(test.planned_start);
  if (plan && days.includes(plan)) {
    add({ id: 'ps', k: 'line', n: { x1: xs(plan), y1: rows.test.y + 2, x2: xs(plan), y2: rows.test.y + rows.test.h - 2, o: 1 }, stroke: motor.list.some((s) => s.crit === 'planned start') ? C.ink : C.faint, width: 1 });
    add({ id: 'psl', k: 'text', n: { x: xs(plan) - 4, y: rows.test.y + rows.test.h - 6, o: 1 }, text: 'planned start', size: 9.5, anchor: 'end', fill: C.muted });
  }

  // Milestone: target diamond, lateness.
  const finishes = motor.list.map((_, i) => runFor(i).finish).filter(Boolean);
  const lates = target ? finishes.map((f) => Math.max(0, cal.wdBetween(target, f))) : [];
  if (target) {
    const tx = xe(target);
    const worst = finishes.sort().slice(-1)[0];
    const lo = Math.min(...lates); const hi = Math.max(...lates);
    if (worst && hi > 0) {
      add({ id: 'late', k: 'line', n: { x1: tx, y1: mileY, x2: xe(worst), y2: mileY, o: 1 }, stroke: C.critical, width: 2.5 });
      add({ id: 'latel', k: 'text', n: { x: Math.min(W - PADR, (tx + xe(worst)) / 2), y: mileY + 20, o: 1 }, text: `${lo === hi ? hi : `${lo}–${hi}`} working day${hi === 1 ? '' : 's'} late`, size: 11, anchor: (tx + xe(worst)) / 2 > W - 80 ? 'end' : 'middle', fill: C.critical, weight: 500, halo: true });
    } else if (worst) {
      add({ id: 'latel', k: 'text', n: { x: tx, y: mileY + 20, o: 1 }, text: 'on time', size: 11, anchor: 'middle', fill: C.ink, halo: true });
    }
    const pol = card.milestone?.policy;
    add({ id: 'md', k: 'diamond', n: { cx: tx, cy: mileY, r: 7, o: 1 }, fill: C.accent, stroke: C.ink,
      pop: { title: card.milestone?.name || 'Milestone', lines: [`Target ${day(target)}`, pol?.usd_per_day ? `A day late costs ${money(pol.usd_per_day)} (owner ${first(pol.owner)})` : 'No $/day policy set'], source: 'Milestone policy' } });
    add({ id: 'mdl', k: 'text', n: { x: tx, y: mileY - 12, o: 1 }, text: `target ${day(target)}`, size: 10.5, anchor: 'middle', fill: C.ink, halo: true });
  }

  // Caption for the chosen tier.
  const runsSel = motor.list.map((s, i) => ({ s, r: runFor(i) })).filter((x) => x.r.finish);
  const doneTxt = runsSel.length === 1 ? day(runsSel[0].r.finish)
    : runsSel.map(({ s, r }) => `${day(r.finish)} ${motor.mode === 'conflict' ? `if ${first(s.who)} is right` : s.lane}`).join(', ');
  const lateLo = lates.length ? Math.min(...lates) : null; const lateHi = lates.length ? Math.max(...lates) : null;
  const lateTxt = lateHi == null ? '' : lateHi === 0 ? 'on time' : `${lateLo === lateHi ? lateHi : `${lateLo}–${lateHi}`} working day${lateHi === 1 ? '' : 's'} late`;
  const crits = [...new Set(motor.list.map((s) => s.crit).filter(Boolean))];
  const caption = { tier: sel.label, done: doneTxt, late: lateTxt, lateBad: lateHi > 0, crit: crits.length === 1 ? `${crits[0]} sets the start` : `start set by ${crits.join(' or ')}` };

  const left = [
    { y: rows.bracket.y, icon: 'bracket', title: 'Bracket', sub: ['this order', card.part?.number].filter(Boolean) },
    { y: rows.motor.y, icon: 'motor', title: inp ? (/motor/i.test(inp.name) ? 'Motor' : inp.name) : 'Inputs', sub: inp ? [inp.name, motor.mode === 'conflict' ? 'two sources' : `${first(inp.said_by)}, ${inp.said_ago}`] : [] },
    { y: rows.test.y, icon: 'test', title: /spin/i.test(card.test?.name || '') ? 'Spin test' : 'Test', sub: [`${pl(card.test?.duration_days, 'working day')}`], noSub2: nS > 1 },
    { y: rows.mile.y, icon: 'mile', title: 'Milestone', sub: [target ? `target ${day(target)}` : 'no target'] },
  ];
  const tierLabels = tiers.map((t, i) => ({ tier: t.tier, y: laneY(i), label: t.label, price: money(t.total), on: t === sel, dominated: !!t.no_faster_than }));

  const geom = { H: { v: H }, __row0: { v: rows.motor.y }, __row1: { v: rows.test.y }, __row2: { v: rows.mile.y } };
  for (const it of items) geom[it.id] = { ...it.n, o: it.n.o ?? 1 };
  return { items, geom, days, xs, dw, nowX, H, rows, holGroups, left, tierLabels, tiers, sel, caption, cal, mode: motor.mode };
}

// ---- Tweening: interpolate every numeric field between the previous scene and the new one. ----
let lastGeom = null; // survives the card remount on a tab change, so the new card animates from the old one
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

function startFrom(prev, target, items) {
  const out = {};
  const spawnOf = Object.fromEntries(items.map((i) => [i.id, i.spawn]));
  for (const [id, n] of Object.entries(target)) {
    if (prev?.[id]) out[id] = prev[id];
    else if (spawnOf[id] && prev?.[spawnOf[id]]) out[id] = { ...n, ...pick(prev[spawnOf[id]], n), o: 0 };
    else out[id] = 'o' in n ? { ...n, o: 0 } : n;
  }
  return out;
}
const pick = (src, like) => Object.fromEntries(Object.keys(like).filter((k) => k in src).map((k) => [k, src[k]]));

function useTween(target, items, ms = 700) {
  const sig = JSON.stringify(target);
  const [cur, setCur] = React.useState(() => (reduced() ? target : startFrom(lastGeom, target, items)));
  const curRef = React.useRef(cur);
  React.useEffect(() => {
    const from = startFrom(curRef.current, target, items);
    if (reduced()) { curRef.current = target; lastGeom = target; setCur(target); return undefined; }
    let raf; const t0 = performance.now();
    const step = (t) => {
      const k = ease(Math.min(1, (t - t0) / ms));
      const next = {};
      for (const [id, n] of Object.entries(target)) {
        const f = from[id] || n; next[id] = {};
        for (const key of Object.keys(n)) { const a = f[key] ?? n[key]; next[id][key] = a + (n[key] - a) * k; }
      }
      curRef.current = next; lastGeom = next; setCur(next);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [sig]); // eslint-disable-line react-hooks/exhaustive-deps
  return cur;
}

// ---- Rendering ----
function Icon({ kind, x, y, C }) {
  const s = { fill: 'none', stroke: C.ink, strokeWidth: 1.4, strokeLinejoin: 'round', strokeLinecap: 'round' };
  if (kind === 'bracket') return <path d={`M${x} ${y - 6} v12 h12 M${x + 3} ${y + 3} h0`} style={s}/>;
  if (kind === 'motor') return <g style={s}><circle cx={x + 6} cy={y} r={6}/><circle cx={x + 6} cy={y} r={2}/></g>;
  if (kind === 'test') return <g style={s}><path d={`M${x + 11} ${y - 3} A6 6 0 1 0 ${x + 12} ${y + 2}`}/><path d={`M${x + 12} ${y - 7} v4 h-4`}/></g>;
  return <path d={`M${x + 6} ${y - 6} l6 6 l-6 6 l-6 -6 z`} style={{ ...s, fill: C.accent }}/>;
}

function edgePath({ x1, y1, x2, y2 }) {
  if (x2 - x1 < 90) return `M${x1} ${y1} C${x1 + 8} ${y1 + (y2 - y1) * 0.75}, ${x2 - 30} ${y2}, ${x2} ${y2}`;
  const dx = (x2 - x1) * 0.5;
  return `M${x1} ${y1} C${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
}

export default function DependencyGraph({ card, C, sourceLabel }) {
  const tiers = React.useMemo(() => [...(card.tiers || [])].sort((a, b) => a.total - b.total), [card]);
  const initial = card.recommended || tiers[0]?.tier;
  const [tier, setTier] = React.useState(initial);
  React.useEffect(() => { setTier(initial); }, [card, initial]);
  const scene = React.useMemo(() => buildScene(card, tier, { C, sourceLabel }), [card, tier, C, sourceLabel]);
  const g = useTween(scene.geom, scene.items);
  const [pop, setPop] = React.useState(null);
  const wrap = React.useRef(null);
  const uid = React.useId().replace(/:/g, '');

  if (!tiers.length) return null;
  const H = g.H?.v ?? scene.H;
  const show = (e, it, pinned) => {
    if (!it.pop) return;
    const box = wrap.current.getBoundingClientRect();
    const r = e.currentTarget.getBoundingClientRect();
    const cx = e.clientX ? e.clientX : r.left + r.width / 2;
    const cy = e.clientY ? e.clientY : r.top;
    setPop((p) => (pinned && p?.id === it.id && p.pinned ? null : { id: it.id, ...it.pop, pinned, x: Math.min(Math.max(cx - box.left, 120), box.width - 120), y: cy - box.top }));
  };
  const hover = (it) => (it.pop ? {
    tabIndex: 0, role: 'button', 'aria-label': `${it.pop.title}: ${it.pop.lines.join('. ')}`,
    onMouseEnter: (e) => { if (!pop?.pinned) show(e, it, false); },
    onMouseLeave: () => setPop((p) => (p?.pinned ? p : null)),
    onFocus: (e) => show(e, it, false), onBlur: () => setPop((p) => (p?.pinned ? p : null)),
    onClick: (e) => { if (it.tier) setTier(it.tier); show(e, it, true); },
    style: { cursor: 'pointer', outline: 'none' },
  } : {});

  const arrow = (c) => `url(#${uid}-a-${c})`;
  const render = (it) => {
    const n = g[it.id]; if (!n) return null;
    const op = Math.max(0, Math.min(1, n.o ?? 1)) * (it.o ?? 1);
    const hot = pop?.id === it.id;
    switch (it.k) {
      case 'rect': return <rect key={it.id} x={n.x} y={n.y} width={Math.max(0, n.w)} height={n.h} rx={it.rx || 0} fill={it.fill} stroke={hot ? C.ink : it.stroke} strokeWidth={hot ? 1.5 : 1} strokeDasharray={it.dash} opacity={op} {...hover(it)}/>;
      case 'line': return <g key={it.id} opacity={op} {...hover(it)}>
        <line x1={n.x1} y1={n.y1} x2={n.x2} y2={n.y2} stroke={it.stroke} strokeWidth={hot ? (it.width || 1) + 1 : it.width || 1} strokeDasharray={it.dash}/>
        {it.pop && <line x1={n.x1} y1={n.y1} x2={n.x2} y2={n.y2} stroke="transparent" strokeWidth={12}/>}
      </g>;
      case 'text': return <text key={it.id} x={n.x} y={n.y} fontSize={it.size} textAnchor={it.anchor || 'start'} fill={it.fill} fontWeight={it.weight || 400} opacity={op} style={{ ...(it.halo ? halo : {}), pointerEvents: 'none', fontVariantNumeric: 'tabular-nums' }}>{it.text}</text>;
      case 'circle': return <circle key={it.id} cx={n.cx} cy={n.cy} r={hot ? n.r + 1.5 : n.r} fill={it.fill} stroke={it.stroke} strokeWidth={it.width || 1} opacity={op} {...hover(it)}/>;
      case 'diamond': return <path key={it.id} d={`M${n.cx} ${n.cy - n.r} L${n.cx + n.r} ${n.cy} L${n.cx} ${n.cy + n.r} L${n.cx - n.r} ${n.cy} Z`} fill={it.fill} stroke={it.stroke} strokeWidth={1.4} opacity={op} {...hover(it)}/>;
      case 'bracket': return <path key={it.id} d={`M${n.x1} ${n.y + 4} V${n.y} H${n.x2} V${n.y + 4}`} fill="none" stroke={it.stroke} strokeWidth={1.2} opacity={op}/>;
      case 'pill': { const w = textW(it.text, it.size) + 16; return <g key={it.id} opacity={op} style={{ pointerEvents: 'none' }}>
        <rect x={n.x} y={n.y} width={w} height={18} rx={9} fill={it.fill}/>
        <text x={n.x + 8} y={n.y + 12.5} fontSize={it.size} fill={it.color}>{it.text}</text></g>; }
      case 'edge': { const c = it.crit ? 'ink' : 'faint'; const d = edgePath(n); return <g key={it.id} opacity={op} {...hover(it)}>
        <path d={d} fill="none" stroke={it.crit ? C.ink : C.faint} strokeWidth={hot ? 2.6 : it.crit ? 1.8 : 1.1} markerEnd={arrow(c)}/>
        <path d={d} fill="none" stroke="transparent" strokeWidth={12}/>
        <circle cx={n.x1} cy={n.y1} r={2.6} fill={it.crit ? C.ink : C.faint}/></g>; }
      default: return null;
    }
  };

  const under = scene.items.filter((i) => i.under);
  const masks = scene.items.filter((i) => i.layer === 'mask');
  const testBars = scene.items.filter((i) => i.layer === 'test');
  const edges = scene.items.filter((i) => i.k === 'edge');
  const rest = scene.items.filter((i) => !i.under && i.layer !== 'mask' && i.layer !== 'test' && i.k !== 'edge');
  const cap = scene.caption;
  const rowBounds = [scene.rows.motor.y, scene.rows.test.y, scene.rows.mile.y].map((y0, i) => g[`__row${i}`]?.v ?? y0);

  return <div ref={wrap} style={{ position: 'relative', padding: '14px 16px 6px', borderBottom: `1px solid ${C.hair}` }}>
    <style>{`@media (prefers-reduced-motion: reduce) { .tv-dg * { transition: none !important; } }`}</style>
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 6 }}>
      <span style={{ fontSize: 11, letterSpacing: '.1em', textTransform: 'uppercase', color: C.muted, marginRight: 4 }}>What the test waits on</span>
      <div role="radiogroup" aria-label="Bracket tier feeding the test" style={{ display: 'flex', gap: 6 }}>
        {tiers.map((t) => { const on = t.tier === tier; return <button key={t.tier} role="radio" aria-checked={on} onClick={() => setTier(t.tier)}
          style={{ border: `1px solid ${on ? C.ink : C.line}`, background: on ? C.ink : '#fff', color: on ? C.paper : C.ink, borderRadius: 14, padding: '4px 11px', fontSize: 12, cursor: 'pointer', display: 'flex', gap: 6, alignItems: 'baseline' }}>
          {t.label}<span style={{ color: on ? C.faint : C.muted, fontVariantNumeric: 'tabular-nums' }}>{money(t.total)}</span>
          {t.tier === card.recommended && <span style={{ width: 6, height: 6, borderRadius: 3, background: C.accent, alignSelf: 'center', boxShadow: on ? 'none' : `0 0 0 1px ${C.ink}` }} title="preselected"/>}
        </button>; })}
      </div>
      <span aria-live="polite" style={{ marginLeft: 'auto', fontSize: 13 }}>
        <b style={{ fontWeight: 500 }}>{cap.tier}</b>: test done {cap.done}{cap.late && <> · <span style={{ color: cap.lateBad ? C.critical : C.ink }}>{cap.late}</span></>}
        <span style={{ color: C.muted }}> · {cap.crit}</span>
      </span>
    </div>

    <svg className="tv-dg" viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: 'block', minWidth: 600, overflow: 'visible' }} role="img"
      aria-label={`Dependency timeline. ${cap.tier}: test done ${cap.done}. ${cap.late}.`} onClick={(e) => { if (e.target === e.currentTarget) setPop(null); }}>
      <defs>
        {[['ink', C.ink], ['faint', C.faint]].map(([k, c]) => <marker key={k} id={`${uid}-a-${k}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" markerUnits="userSpaceOnUse" orient="auto-start-reverse"><path d="M0 1 L9 5 L0 9 z" fill={c}/></marker>)}
        <pattern id="tv-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill={C.paper}/><line x1="0" y1="0" x2="0" y2="6" stroke={C.faint} strokeWidth="2"/></pattern>
      </defs>

      {under.map(render)}
      {/* Axis */}
      {scene.days.map((d, i) => { const x = scene.xs(d) + scene.dw / 2; const dt = new Date(d + 'T00:00:00Z'); const wkd = dt.getUTCDay(); const off = !scene.cal.isWd(d);
        const month = i === 0 || dt.getUTCDate() === 1;
        return <g key={d} style={{ pointerEvents: 'none' }}>
          {month && <text x={scene.xs(d) + 2} y={11} fontSize={10.5} fill={C.ink} fontWeight={500} letterSpacing=".06em">{['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'][dt.getUTCMonth()]}</text>}
          <text x={x} y={27} fontSize={9.5} textAnchor="middle" fill={off ? C.faint : C.muted}>{WD2[wkd]}</text>
          <text x={x} y={42} fontSize={11.5} textAnchor="middle" fill={off ? C.faint : C.ink} style={{ fontVariantNumeric: 'tabular-nums' }}>{dt.getUTCDate()}</text>
          {wkd === 1 && <line x1={scene.xs(d)} y1={AX - 2} x2={scene.xs(d)} y2={H - 16} stroke={C.hair}/>}
        </g>; })}
      {scene.holGroups.map((gp) => { const x = (scene.xs(gp[0]) + scene.xs(gp[gp.length - 1]) + scene.dw) / 2; const h = HOLIDAYS.find((x) => x.date === gp[0]);
        return <text key={gp[0]} x={x} y={H - 4} fontSize={9.5} textAnchor="middle" fill={C.muted} style={{ pointerEvents: 'none' }}>{h?.name || 'Holiday'}</text>; })}
      <line x1={X0} y1={AX - 2} x2={W - PADR} y2={AX - 2} stroke={C.line}/>
      {rowBounds.map((y0, i) => <line key={i} x1={8} y1={y0} x2={W - PADR} y2={y0} stroke={C.hair}/>)}

      {/* Left labels */}
      {scene.left.map((r) => <g key={r.icon} style={{ pointerEvents: 'none' }}>
        <Icon kind={r.icon} x={8} y={r.y + 18} C={C}/>
        <text x={28} y={r.y + 22} fontSize={13.5} fill={C.ink} fontWeight={500}>{r.title}</text>
        {r.sub.slice(0, r.noSub2 ? 1 : 2).map((s, j) => <text key={j} x={28} y={r.y + 37 + j * 13} fontSize={10.5} fill={C.muted}>{s.length > 26 ? s.slice(0, 25) + '…' : s}</text>)}
      </g>)}
      {scene.tierLabels.map((t) => <g key={t.tier} style={{ cursor: 'pointer' }} onClick={() => setTier(t.tier)}>
        <text x={X0 - 10} y={t.y + 4} fontSize={11.5} textAnchor="end" fill={t.on ? C.ink : C.muted} fontWeight={t.on ? 500 : 400}>
          {t.label} <tspan fill={t.dominated ? C.critical : C.muted} fontWeight={400}>{t.price}</tspan></text>
      </g>)}

      {testBars.map(render)}
      {masks.map(render)}
      {rest.filter((i) => i.k !== 'text' && i.k !== 'pill').map(render)}
      {edges.map(render)}
      {rest.filter((i) => i.k === 'text' || i.k === 'pill').map(render)}

      {/* Today */}
      <line x1={scene.nowX} y1={AX - 2} x2={scene.nowX} y2={H - 22} stroke={C.ink} strokeWidth={1} style={{ pointerEvents: 'none' }}/>
      <g style={{ pointerEvents: 'none' }}><rect x={scene.nowX - 18} y={H - 22} width={36} height={14} rx={7} fill={C.accent}/>
        <text x={scene.nowX} y={H - 11.5} fontSize={9.5} textAnchor="middle" fill={C.ink} fontWeight={500}>now</text></g>
    </svg>

    {pop && <div role="tooltip" style={{ position: 'absolute', left: pop.x, top: pop.y + 14, transform: 'translateX(-50%)', zIndex: 5, minWidth: 200, maxWidth: 300, background: '#fff', border: `1px solid ${C.line}`, borderRadius: 8, boxShadow: '0 6px 24px rgba(28,27,23,.12)', padding: '9px 12px', fontSize: 12, lineHeight: 1.45, pointerEvents: pop.pinned ? 'auto' : 'none' }}>
      <div style={{ fontWeight: 500, marginBottom: 2 }}>{pop.title}</div>
      {pop.lines.map((l, i) => <div key={i} style={{ color: C.ink }}>{l}</div>)}
      {pop.source && <div style={{ marginTop: 5, paddingTop: 5, borderTop: `1px solid ${C.hair}`, color: C.muted, fontSize: 11 }}>{pop.source}</div>}
    </div>}
  </div>;
}
