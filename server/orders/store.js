import {DatabaseSync} from 'node:sqlite';
import {mkdirSync} from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {AppError, specHash, PAYMENT_STATES, BOOKING_STATES} from '../contracts.js';

const transitions = {
  entered: ['resolving'], resolving: ['needs_answer', 'recommended'],
  needs_answer: ['resolving', 'recommended'], recommended: ['resolving', 'needs_answer'],
  specified: ['requested'], requested: ['approved', 'rejected'],
  approved: [], placed: ['delivered'], delivered: ['in_use'], in_use: [],
};
const exits = ['cancelled', 'unresolved', 'superseded', 'invalidated'];
const editable = ['entry', 'spec', 'quote', 'decision', 'decisionRevision'];
const clone = value => structuredClone(value);
const fail = (message, status = 409) => { throw new AppError(message, status); };
const nonempty = value => typeof value === 'string' && value.trim().length > 0;

export function createOrderStore({filename = 'data/orders.sqlite'} = {}) {
  if (filename !== ':memory:') mkdirSync(path.dirname(filename), {recursive: true});
  const db = new DatabaseSync(filename);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS orders(id TEXT PRIMARY KEY, state TEXT NOT NULL, body TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS order_events(seq INTEGER PRIMARY KEY AUTOINCREMENT, order_id TEXT NOT NULL, body TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS placement_attempts(id TEXT PRIMARY KEY, order_id TEXT NOT NULL, body TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS inbound_events(source TEXT NOT NULL, external_id TEXT NOT NULL, PRIMARY KEY(source,external_id));`);
  let depth = 0;
  function tx(fn) {
    if (depth) return fn();
    db.exec('BEGIN IMMEDIATE'); depth++;
    try { const result = fn(); if (result?.then) fail('Transaction callback must be synchronous', 400); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
    finally { depth--; }
  }
  const get = id => {
    const row = db.prepare('SELECT body FROM orders WHERE id=?').get(id);
    if (!row) fail('Order not found', 404);
    return JSON.parse(row.body);
  };
  const list = () => db.prepare('SELECT body FROM orders ORDER BY rowid').all().map(row => JSON.parse(row.body));
  function save(order, event, detail = {}) {
    order.updatedAt = new Date().toISOString();
    db.prepare('INSERT INTO orders VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET state=excluded.state,body=excluded.body').run(order.id, order.state, JSON.stringify(order));
    db.prepare('INSERT INTO order_events(order_id,body) VALUES(?,?)').run(order.id, JSON.stringify({at: order.updatedAt, event, revision: order.revision, detail}));
    return clone(order);
  }
  function checked(id, revision) {
    const order = get(id);
    if (!Number.isInteger(revision) || order.revision !== revision) fail('Order revision changed');
    return order;
  }
  function change(order, patch, event) {
    Object.assign(order, clone(patch)); order.revision++;
    return save(order, event, patch);
  }
  function create(entry = {}) {
    if (!nonempty(entry.name)) fail('Part name is required', 400);
    const at = new Date().toISOString();
    return tx(() => save({id: randomUUID(), revision: 0, state: 'entered', paymentState: 'none', bookingState: 'pending',
      entry: {...clone(entry), name: entry.name.trim(), note: entry.note || '', engineer: entry.engineer || '', cadHash: entry.cadHash || null, cadFileName: entry.cadFileName || null, enteredAt: at},
      spec: [], quote: null, decision: null, decisionRevision: null, frozen: null, specHash: null,
      ramp: {requestId: null, approvalStatus: null, cardId: null, transactionIds: [], receiptId: null},
      vendorOrder: {vendorOrderId: null, promisedOn: null}, createdAt: at, updatedAt: at}, 'order.created'));
  }
  function update(id, revision, patch, event = 'order.updated') {
    return tx(() => {
      const order = checked(id, revision);
      if (!patch || Object.keys(patch).some(key => ![...editable, 'state'].includes(key))) fail('Protected or unknown order field', 400);
      if (order.frozen && editable.some(key => key in patch)) fail('Frozen specification and decision cannot be edited');
      if (!(order.state in transitions)) fail('Order is terminal or requires a dedicated transition');
      if (patch.state && patch.state !== order.state) {
        const allowed = transitions[order.state].includes(patch.state) || (!['placed', 'delivered', 'in_use'].includes(order.state) && exits.includes(patch.state));
        if (!allowed) fail(`Illegal transition ${order.state} -> ${patch.state}`);
        if (patch.state === 'requested' && !order.ramp.requestId) fail('Ramp request is required');
        if (patch.state === 'approved' && order.ramp.approvalStatus !== 'APPROVED') fail('Current Ramp approval is required');
      }
      return change(order, patch, event);
    });
  }
  function freeze(id, revision, frozen) {
    return tx(() => {
      const order = checked(id, revision);
      if (order.state !== 'recommended' || order.frozen) fail('Order is not ready to freeze');
      if (!frozen || !['partName', 'cadHash', 'vendor', 'quoteId', 'tier', 'currency'].every(key => nonempty(frozen[key])) ||
          !Number.isSafeInteger(frozen.priceCents) || frozen.priceCents < 0 || !frozen.fields ||
          !frozen.total || typeof frozen.total.includesTax !== 'boolean' || typeof frozen.total.includesShipping !== 'boolean' ||
          !Number.isSafeInteger(frozen.total.varianceCents) || frozen.total.varianceCents < 0) fail('Incomplete frozen order', 400);
      const required = ['material', 'finish', 'tolerance', 'quantity', 'revision', 'inspection', 'shipTo'];
      for (const key of required) {
        const field = order.spec.find(item => item.key === key);
        if (!field?.provenance || !['string', 'number'].includes(typeof field.value) || field.value === '' || (typeof field.value === 'number' && !Number.isFinite(field.value)) || field.value !== frozen.fields[key]) fail(`Unconfirmed specification: ${key}`, 400);
      }
      if (!Number.isSafeInteger(frozen.fields.quantity) || frozen.fields.quantity <= 0) fail('Invalid quantity', 400);
      const option = order.quote?.options.find(item => item.tier === frozen.tier);
      if (order.quote?.completeness !== 'complete' || order.quote.quoteId !== frozen.quoteId || order.quote.vendor !== frozen.vendor || option?.priceCents !== frozen.priceCents) fail('Frozen order does not match quote');
      if (order.entry.cadHash !== frozen.cadHash || !order.decision?.snapshotHash || !Number.isInteger(order.decisionRevision)) fail('CAD or decision snapshot missing');
      if (!order.decision.options?.some(item => item.tier === frozen.tier && item.admissible)) fail('Tier is not admissible');
      return change(order, {frozen: clone(frozen), specHash: specHash(frozen), state: 'specified'}, 'order.frozen');
    });
  }
  const attempts = id => db.prepare('SELECT body FROM placement_attempts WHERE order_id=? ORDER BY rowid').all(id).map(row => JSON.parse(row.body));
  const saveAttempt = attempt => db.prepare('INSERT INTO placement_attempts VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body').run(attempt.id, attempt.orderId, JSON.stringify(attempt));
  function beginPlacement(id, revision) {
    return tx(() => {
      const order = checked(id, revision);
      if (order.state !== 'approved' || !order.frozen || order.specHash !== specHash(order.frozen) || order.ramp.approvalStatus !== 'APPROVED' || order.paymentState !== 'issued' || !order.ramp.cardId) fail('Order is not authorized and funded for placement');
      if (attempts(id).some(a => a.outcome === null || a.outcome === 'unknown' || a.outcome === 'succeeded')) fail('Order has an unresolved or successful placement');
      for (const value of [order.quote?.validUntil, order.quote?.cutoff]) if (value && (!Number.isFinite(Date.parse(value)) || Date.parse(value) <= Date.now())) fail('Quote or cutoff is stale');
      const attempt = {id: randomUUID(), orderId: id, n: attempts(id).length + 1, specHash: order.specHash, decisionRevision: order.decisionRevision, startedAt: new Date().toISOString(), outcome: null, vendorOrderId: null, reason: null, finishedAt: null};
      saveAttempt(attempt); change(order, {state: 'placing'}, 'placement.started'); return clone(attempt);
    });
  }
  function endPlacement(attemptId, outcome, detail = {}) {
    return tx(() => {
      const row = db.prepare('SELECT body FROM placement_attempts WHERE id=?').get(attemptId);
      if (!row) fail('Attempt not found', 404);
      const attempt = JSON.parse(row.body), order = get(attempt.orderId);
      if (attempt.outcome !== null || order.state !== 'placing') fail('Attempt already resolved or requires reconciliation');
      if (!['succeeded', 'failed', 'blocked', 'unknown'].includes(outcome)) fail('Invalid placement outcome', 400);
      if (outcome === 'succeeded' && !nonempty(detail.vendorOrderId)) fail('Vendor confirmation required', 400);
      Object.assign(attempt, {outcome, vendorOrderId: detail.vendorOrderId || null, reason: detail.reason || null, finishedAt: new Date().toISOString()}); saveAttempt(attempt);
      return change(order, {state: outcome === 'succeeded' ? 'placed' : outcome === 'unknown' ? 'placement_unknown' : 'approved', ...(outcome === 'succeeded' ? {vendorOrder: {vendorOrderId: detail.vendorOrderId, promisedOn: detail.promisedOn || null}} : {})}, `placement.${outcome}`);
    });
  }
  function reconcile(id, resolution) {
    return tx(() => {
      const order = get(id);
      if (order.state !== 'placement_unknown') fail('Order does not need reconciliation');
      if (!nonempty(resolution?.vendorOrderId) && !(resolution?.cancelled === true && nonempty(resolution.reason))) fail('Confirmation or explicit cancellation evidence required', 400);
      const attempt = attempts(id).at(-1);
      Object.assign(attempt, {outcome: resolution.cancelled ? 'blocked' : 'succeeded', reason: resolution.reason || 'Vendor confirmation reconciled', vendorOrderId: resolution.vendorOrderId || null, finishedAt: new Date().toISOString()}); saveAttempt(attempt);
      return change(order, {state: resolution.cancelled ? 'cancelled' : 'placed', vendorOrder: {vendorOrderId: resolution.vendorOrderId || null, promisedOn: resolution.promisedOn || null}}, 'placement.reconciled');
    });
  }
  function recordRamp(id, revision, patch, event = 'ramp.updated') {
    return tx(() => {
      const order = checked(id, revision);
      const {paymentState, bookingState, ...ramp} = patch;
      if (Object.keys(ramp).some(key => !['requestId', 'approvalStatus', 'cardId', 'transactionIds', 'receiptId'].includes(key))) fail('Unknown Ramp field', 400);
      if (paymentState && !PAYMENT_STATES.includes(paymentState) || bookingState && !BOOKING_STATES.includes(bookingState)) fail('Invalid accounting state', 400);
      if (ramp.approvalStatus && !['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'].includes(ramp.approvalStatus)) fail('Invalid approval status', 400);
      if (ramp.approvalStatus === 'APPROVED' && !['requested', 'approved'].includes(order.state)) fail('Cannot approve superseded or inactive order');
      if (ramp.approvalStatus === 'PENDING' && order.ramp.approvalStatus && order.ramp.approvalStatus !== 'PENDING') fail('Stale approval status');
      if (paymentState && order.paymentState === 'charged' && paymentState !== 'charged') fail('Stale payment status');
      if (bookingState && order.bookingState === 'coded' && bookingState !== 'coded') fail('Stale booking status');
      if (order.ramp.requestId && ramp.requestId && order.ramp.requestId !== ramp.requestId) fail('Request identity cannot change');
      if (order.ramp.cardId && ramp.cardId && order.ramp.cardId !== ramp.cardId) fail('Card identity cannot change');
      if (ramp.transactionIds && (!Array.isArray(ramp.transactionIds) || !ramp.transactionIds.every(nonempty))) fail('Invalid transaction IDs', 400);
      ramp.transactionIds = [...new Set([...order.ramp.transactionIds, ...(ramp.transactionIds || [])])];
      return change(order, {ramp: {...order.ramp, ...ramp}, ...(paymentState ? {paymentState} : {}), ...(bookingState ? {bookingState} : {})}, event);
    });
  }
  const seenEvent = (source, id) => !!db.prepare('SELECT 1 FROM inbound_events WHERE source=? AND external_id=?').get(source, id);
  function processEvent(source, id, callback) {
    if (!nonempty(source) || !nonempty(id) || typeof callback !== 'function') fail('Invalid inbound event', 400);
    return tx(() => {
      if (seenEvent(source, id)) return {duplicate: true};
      const value = callback();
      if (value?.then) fail('Event callback must be synchronous', 400);
      db.prepare('INSERT INTO inbound_events VALUES(?,?)').run(source, id);
      return {duplicate: false, value};
    });
  }
  // Opening the single-writer store after process restart cannot assume the vendor did not receive the click.
  tx(() => { for (const order of list().filter(o => o.state === 'placing')) {
    for (const attempt of attempts(order.id).filter(a => a.outcome === null)) { attempt.outcome = 'unknown'; attempt.reason = 'Interrupted placement; reconcile before retry'; saveAttempt(attempt); }
    change(order, {state: 'placement_unknown'}, 'placement.interrupted');
  } });
  return {create, get, list, update, freeze, beginPlacement, endPlacement, reconcile, recordRamp, seenEvent, processEvent,
    attempts, events: id => db.prepare('SELECT body FROM order_events WHERE order_id=? ORDER BY seq').all(id).map(row => JSON.parse(row.body)), close: () => db.close()};
}
