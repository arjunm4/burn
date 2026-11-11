// Human notifications: the Slack-DM-style messages each person would get as an order
// moves. Subscribes to the orchestrator bus and writes one row per (order, event, revision,
// text) into SQLite, so a replayed or re-published event never produces a second message.
// Recipients: the order's engineer, the owner of an open question, or the manager (the
// approver) for approval-facing events. Text is built from the order's own numbers only.
import {DatabaseSync} from 'node:sqlite';
import {mkdirSync} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';

const money = c => (c == null ? '—' : '$' + Math.round(c / 100).toLocaleString('en-US'));
const day = iso => (iso ? new Date(iso.length === 10 ? iso + 'T00:00:00Z' : iso).toLocaleDateString('en-US', {month: 'short', day: 'numeric', timeZone: 'UTC'}) : 'unknown');
const clock = (iso, tz) => new Date(iso).toLocaleTimeString('en-US', {hour: 'numeric', minute: '2-digit', timeZone: tz, timeZoneName: 'short'});

/** Which messages an event produces: [{to, kind, text}] or nothing. `extra` is the bus payload beyond the order. */
export function messagesFor(e, {manager = 'manager', timeZone = 'America/Los_Angeles'} = {}) {
  const o = e.order; if (!o) return [];
  const eng = o.entry?.engineer || 'engineer';
  const name = o.entry?.name || 'part';
  const price = money(o.frozen?.priceCents);
  const q = o.question;
  switch (e.type) {
    case 'recommended': {
      // The quote and the recommendation in one line, numbers from the order itself.
      const tiers = (o.decision?.options || []).filter(t => t.admissible).map(t => { const qo = o.quote?.options.find(x => x.tier === t.tier); return `${t.tier} ${money(qo?.priceCents)} ready ${day(qo?.readyOn)}`; }).join(' vs ');
      const rec = o.decision?.recommended ? `Recommendation: ${o.decision.text}` : `No recommendation yet: ${o.decision?.text || ''}`;
      return [{to: eng, kind: 'quote', text: `Quote ready for ${name}: ${tiers}. ${rec}`.trim()}];
    }
    case 'question': {
      const question = e.question || q; if (!question) return [];
      const to = question.kind === 'fact' && question.owner ? question.owner : eng;
      return [{to, kind: 'question', text: `${name}: ${question.text}${to !== eng ? ` (asked for ${eng}'s order; one fact decides the tier)` : ''}`}];
    }
    case 'ramp.requested': {
      const cutoff = o.quote?.cutoff ? ` Approve by ${clock(o.quote.cutoff, timeZone)} to start production today.` : '';
      return [{to: manager, kind: 'approval', text: `Approval needed: ${eng}'s Xometry order ${price} (${name}, ${o.frozen?.tier}). ${o.decision?.text || ''}${cutoff}`.trim()},
        {to: eng, kind: 'status', text: `Sent to Ramp for approval: ${name}, ${o.frozen?.tier} ${price}.`}];
    }
    case 'ramp.request.failed': return [{to: eng, kind: 'problem', text: `${name}: ${q?.text || 'the Ramp request failed'}.`}];
    case 'ramp.approved': return [{to: eng, kind: 'approved', text: `${manager === 'manager' ? 'Your manager' : manager} approved your Xometry order (${name}, ${price}). Placing now.`}];
    case 'ramp.rejected': return [{to: eng, kind: 'rejected', text: `Your Xometry order for ${name} (${price}) was rejected in Ramp. Nothing was bought.`}];
    case 'approval.stale': return [{to: eng, kind: 'problem', text: `${name}: ${q?.text || 'the approval refers to an earlier version of this order; re-approval needed.'}`}];
    case 'card.failed': return [{to: eng, kind: 'problem', text: `${name}: card could not be issued${e.reason ? ` (${e.reason})` : ''}. Nothing was bought.`}];
    case 'placement.notice': return e.text ? [{to: eng, kind: 'placement', text: e.text}] : [];
    case 'placement.succeeded': return [{to: eng, kind: 'placed', text: `Placed. Xometry order ${o.vendorOrder?.vendorOrderId || e.result?.vendorOrderId}, ready ${day(o.vendorOrder?.promisedOn || e.result?.promisedOn)}.`}];
    case 'placement.invalidated': return [{to: eng, kind: 'problem', text: `Stopped before buying: ${q?.text || 'the order needs re-approval'}`}];
    case 'placement.blocked': case 'placement.failed': {
      const why = e.result?.mismatches ? e.result.mismatches.map(m => `${m.field} changed (expected ${m.expected}, got ${m.actual})`).join(', ') : e.result?.reason || 'the vendor page did not match the approved order';
      return [{to: eng, kind: 'problem', text: `Stopped before buying: ${why}. Nothing was ordered.`}];
    }
    case 'placement.unknown': return [{to: eng, kind: 'problem', text: `Xometry's answer was lost while placing ${name}. Checking their records before anything else happens; no automatic retry.`}];
    case 'placement.reconciled': return [{to: eng, kind: 'placed', text: `Found in Xometry's records: order ${o.vendorOrder?.vendorOrderId}, ready ${day(o.vendorOrder?.promisedOn)}.`}];
    case 'placement.unresolved': return [{to: eng, kind: 'problem', text: e.text || 'Vendor response lost and no matching order found yet; a person must confirm before any retry.'}];
    case 'charge.cleared': return [{to: eng, kind: 'charge', text: `Charged ${price} on the Xometry card •••• ${o.ramp?.cardLast4 || '····'}; matched to ${name}.`}];
    case 'booked': return [{to: eng, kind: 'booked', text: `Receipt, memo and project code${o.context?.milestoneLabel ? ` (${o.context.milestoneLabel})` : ''} attached to the ${price} Xometry charge in Ramp.`},
      {to: manager, kind: 'booked', text: `${eng}'s Xometry order (${name}, ${price}) is placed, charged and booked.`}];
    case 'booking.failed': return [{to: eng, kind: 'problem', text: `Charged ${price}, but the receipt could not be attached in Ramp yet; Burn will retry without touching the purchase.`}];
    default: return [];
  }
}

export function createNotifier({bus, filename = process.env.ORDERS_DB || 'data/orders.sqlite', config = {}, now = () => new Date()} = {}) {
  if (filename !== ':memory:') mkdirSync(path.dirname(filename), {recursive: true});
  const db = new DatabaseSync(filename);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS notifications(id TEXT PRIMARY KEY, at TEXT NOT NULL, to_person TEXT NOT NULL, kind TEXT NOT NULL, text TEXT NOT NULL, order_id TEXT, event_type TEXT NOT NULL);`);
  const insert = db.prepare('INSERT OR IGNORE INTO notifications VALUES(?,?,?,?,?,?,?)');
  const subscribers = new Set();
  const opts = {manager: config.company?.manager || 'manager', timeZone: config.company?.timeZone || 'America/Los_Angeles'};
  const row = r => ({id: r.id, at: r.at, to: r.to_person, kind: r.kind, text: r.text, orderId: r.order_id, eventType: r.event_type});

  function onEvent(e) {
    for (const m of messagesFor(e, opts)) {
      // Same order, event, revision and text → same id, so a replay is a no-op (INSERT OR IGNORE).
      const id = createHash('sha256').update(`${e.orderId}|${e.type}|${e.order?.revision}|${m.to}|${m.text}`).digest('hex').slice(0, 24);
      const at = now().toISOString();
      if (insert.run(id, at, m.to, m.kind, m.text, e.orderId || null, e.type).changes === 0) continue;
      const n = {id, at, to: m.to, kind: m.kind, text: m.text, orderId: e.orderId || null, eventType: e.type};
      for (const fn of subscribers) { try { fn(n); } catch {} }
    }
  }
  bus?.on('order', onEvent);

  return {
    /** Oldest first (a feed reads downwards); `limit` keeps the newest N. */
    list({to, since, limit = 50} = {}) {
      const where = [], args = [];
      if (to) { where.push('to_person=?'); args.push(to); }
      if (since) { where.push('at>?'); args.push(since); }
      const rows = db.prepare(`SELECT * FROM notifications${where.length ? ' WHERE ' + where.join(' AND ') : ''} ORDER BY rowid DESC LIMIT ?`).all(...args, limit);
      return rows.reverse().map(row);
    },
    recipients: () => db.prepare('SELECT DISTINCT to_person FROM notifications ORDER BY rowid').all().map(r => r.to_person),
    subscribe(fn) { subscribers.add(fn); return () => subscribers.delete(fn); },
    close() { bus?.off('order', onEvent); db.close(); },
  };
}
