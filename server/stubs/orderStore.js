// TEMPORARY in-memory OrderStore matching server/contracts.js, so the API and screens can
// be built before Codex's SQLite store (server/orders/) lands. Delete when it does.
import {randomUUID} from 'node:crypto';
import {AppError, ORDER_STATES, specHash} from '../contracts.js';

const TRANSITIONS = {
  entered: ['resolving', 'cancelled'], resolving: ['needs_answer', 'recommended', 'unresolved', 'cancelled'],
  needs_answer: ['resolving', 'cancelled', 'unresolved'], recommended: ['specified', 'resolving', 'cancelled'],
  specified: ['requested', 'resolving', 'cancelled'], requested: ['approved', 'rejected', 'cancelled', 'superseded', 'invalidated'],
  approved: ['placing', 'invalidated', 'cancelled', 'superseded'], placing: ['placed', 'approved', 'placement_unknown'],
  placement_unknown: ['placed', 'cancelled'], placed: ['delivered', 'cancelled'], delivered: ['in_use'],
};

export function createMemoryOrderStore() {
  const orders = new Map(), events = new Map(), attempts = new Map(), seen = new Set();
  const nowIso = () => new Date().toISOString();
  const log = (o, event, detail = {}) => { if (!events.has(o.id)) events.set(o.id, []); events.get(o.id).push({at: nowIso(), event, revision: o.revision, detail}); };
  const get = id => { const o = orders.get(id); if (!o) throw new AppError('Order not found', 404); return structuredClone(o); };
  const check = (o, expectedRevision) => { if (expectedRevision !== undefined && o.revision !== expectedRevision) throw new AppError('Order changed. Refresh and try again.', 409); };
  const move = (o, state) => {
    if (o.state === state) return;
    if (!ORDER_STATES.includes(state)) throw new AppError(`Unknown state ${state}`);
    if (!(TRANSITIONS[o.state] || []).includes(state)) throw new AppError(`Cannot go from ${o.state} to ${state}`, 409);
    o.state = state;
  };
  const save = (o, event, detail) => { o.revision++; o.updatedAt = nowIso(); orders.set(o.id, o); log(o, event, detail); return structuredClone(o); };

  return {
    create(entry) {
      const o = {id: 'ord_' + randomUUID().slice(0, 8), revision: 0, state: 'entered', paymentState: 'none', bookingState: 'pending',
        entry: {...entry, enteredAt: nowIso()}, spec: [], quote: null, decision: null, decisionRevision: null, frozen: null, specHash: null,
        ramp: {requestId: null, approvalStatus: null, cardId: null, transactionIds: [], receiptId: null}, vendorOrder: {vendorOrderId: null, promisedOn: null},
        createdAt: nowIso(), updatedAt: nowIso()};
      orders.set(o.id, o); log(o, 'order.entered', {}); return structuredClone(o);
    },
    get, list: () => [...orders.values()].map(o => structuredClone(o)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    update(id, expectedRevision, patch, event) {
      const o = orders.get(id); if (!o) throw new AppError('Order not found', 404); check(o, expectedRevision);
      const {state, ...rest} = patch; Object.assign(o, structuredClone(rest)); if (state) move(o, state);
      return save(o, event, {patch: Object.keys(patch)});
    },
    freeze(id, expectedRevision, frozen) {
      const o = orders.get(id); if (!o) throw new AppError('Order not found', 404); check(o, expectedRevision);
      if (!['recommended', 'needs_answer'].includes(o.state)) throw new AppError(`Cannot freeze from ${o.state}`, 409);
      o.frozen = structuredClone(frozen); o.specHash = specHash(frozen); move(o, 'specified');
      return save(o, 'order.frozen', {specHash: o.specHash});
    },
    beginPlacement(id, expectedRevision) {
      const o = orders.get(id); if (!o) throw new AppError('Order not found', 404); check(o, expectedRevision);
      if (o.state !== 'approved') throw new AppError(`Cannot place from ${o.state}`, 409);
      const open = [...attempts.values()].find(a => a.orderId === id && a.outcome == null);
      if (open) throw new AppError('A placement attempt is already open', 409);
      const n = [...attempts.values()].filter(a => a.orderId === id).length + 1;
      const a = {id: 'att_' + randomUUID().slice(0, 8), orderId: id, n, specHash: o.specHash, decisionRevision: o.decisionRevision, startedAt: nowIso(), outcome: null, vendorOrderId: null, reason: null, finishedAt: null};
      attempts.set(a.id, a); move(o, 'placing'); save(o, 'placement.begun', {attemptId: a.id, n});
      return structuredClone(a);
    },
    endPlacement(attemptId, outcome, detail = {}) {
      const a = attempts.get(attemptId); if (!a) throw new AppError('Attempt not found', 404);
      if (a.outcome) throw new AppError('Attempt already closed', 409);
      const o = orders.get(a.orderId);
      Object.assign(a, {outcome, vendorOrderId: detail.vendorOrderId || null, reason: detail.reason || null, finishedAt: nowIso()});
      if (outcome === 'succeeded') { o.vendorOrder = {vendorOrderId: detail.vendorOrderId, promisedOn: detail.promisedOn || null}; move(o, 'placed'); }
      else if (outcome === 'unknown') move(o, 'placement_unknown');
      else move(o, 'approved');
      return save(o, `placement.${outcome}`, {attemptId, ...detail});
    },
    reconcile(id, resolution) {
      const o = orders.get(id); if (!o) throw new AppError('Order not found', 404);
      if (o.state !== 'placement_unknown') throw new AppError('Only an unknown placement can be reconciled', 409);
      if (resolution.cancelled) move(o, 'cancelled'); else { o.vendorOrder = {vendorOrderId: resolution.vendorOrderId, promisedOn: resolution.promisedOn || null}; move(o, 'placed'); }
      return save(o, 'placement.reconciled', resolution);
    },
    recordRamp(id, expectedRevision, patch, event) {
      const o = orders.get(id); if (!o) throw new AppError('Order not found', 404); check(o, expectedRevision);
      const {paymentState, bookingState, state, ...ramp} = patch; Object.assign(o.ramp, ramp);
      if (paymentState) o.paymentState = paymentState; if (bookingState) o.bookingState = bookingState; if (state) move(o, state);
      return save(o, event, patch);
    },
    events: id => structuredClone(events.get(id) || []),
    attempts: id => [...attempts.values()].filter(a => a.orderId === id).map(a => structuredClone(a)),
    seenEvent(source, externalId) { const k = source + ':' + externalId; if (seen.has(k)) return true; seen.add(k); return false; },
    close() {},
  };
}
