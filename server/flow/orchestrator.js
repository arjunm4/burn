// The order orchestrator (architecture §4): owns the flow from part entry to booked order.
// It reads frozen snapshots, calls the decision core, and talks to the store, vendor and
// Ramp through their contracts. It never invents facts or costs, never approves, and the
// model (when used) only classifies and explains.
import {EventEmitter} from 'node:events';
import {createHash} from 'node:crypto';
import {decide, explain} from '../../src/decision/core.js';
import {buildContext} from './context.js';
import {AppError} from '../contracts.js';

export function createOrchestrator({store, vendor, ramp, ingest = null, config, agent = null, now = () => new Date().toISOString(), log = () => {}}) {
  const bus = new EventEmitter();
  bus.setMaxListeners(100);
  const publish = (order, type = 'order.updated', extra = {}) => bus.emit('order', {type, orderId: order.id, order, ...extra});
  const iso = () => now();
  const today = () => iso().slice(0, 10);

  // Which spec fields are still gaps: engineer answers win, then authorized defaults.
  function resolveSpec(order, ctx) {
    const answered = Object.fromEntries(order.spec.filter(f => f.provenance === 'engineer').map(f => [f.key, f]));
    return config.specFields.map(f => answered[f.key] || (ctx.specSuggestions[f.key] ? {key: f.key, ...ctx.specSuggestions[f.key]} : {key: f.key, value: null, provenance: null}))
      .map(f => (f.key === 'quantity' && f.value != null ? {...f, value: Number.parseInt(f.value, 10)} : f));
  }

  /** Step 1: part entry. Returns at once; resolution continues in the background. */
  function enter({name, note = '', partNumber = null, cad = null, engineer = 'engineer', fields = {}}) {
    if (!name?.trim()) throw new AppError('Part name is required');
    const cadHash = cad?.bytes ? createHash('sha256').update(cad.bytes).digest('hex') : null;
    // `__fault` is a test/demo knob for the fake vendor (drift, drop-option, timeout, reject); it is never a spec field.
    let order = store.create({name: name.trim(), note: note.trim(), partNumber: partNumber?.trim() || null, cadHash, cadFileName: cad?.fileName || null, engineer, fault: fields.__fault || null});
    const given = Object.entries(fields).filter(([k, v]) => k !== '__fault' && v != null && v !== '').map(([key, value]) => ({key, value, provenance: 'engineer', sourceRef: 'part entry'}));
    order = store.update(order.id, order.revision, {spec: given, context: {cad: cad ? {fileName: cad.fileName, bytes: cad.bytes.toString('base64')} : null, overrides: {}}, exchange: []}, 'order.entered');
    publish(order, 'order.entered');
    setImmediate(() => resolve(order.id).catch(e => log('resolve failed', e)));
    return order;
  }

  /** Steps 2–5: context, spec gate, quote, decision. Re-run after every answer or argument. */
  async function resolve(id, {reread = true} = {}) {
    let order = store.get(id);
    order = store.update(id, order.revision, {state: 'resolving', question: null}, 'resolve.started');
    publish(order, 'resolve.started');
    // The agent reads the team's records for this order; if it is unavailable or fails, the rule graph stands in and the card says so.
    // An answer or an argument re-solves on what was already read; new documents (a sync, a live message) make it read again.
    let ctx = null, read = order.context?.agentRead && !reread ? order.context.agentRead : null;
    if (!read && agent?.enabled && ingest) {
      publish(order, 'agent.reading', {model: agent.model});
      try {
        read = await agent.read({order, docs: ingest.listDocuments(), emit: e => publish(order, e.type, e)});
        publish(order, 'agent.claims', {summary: read.summary, nodes: read.graph.nodes.length, edges: read.graph.edges.length, dropped: read.dropped.length});
      } catch (e) { log('agent read failed', e); publish(order, 'agent.fallback', {stage: 'read', reason: e.message}); read = null; }
    }
    if (read) ctx = buildContext({order, ingest, config, now: iso(), graph: read.graph, evidence: read.evidence});
    if (!ctx) ctx = buildContext({order, ingest, config, now: iso()});
    const agentRead = read ? {graph: read.graph, evidence: read.evidence, trace: read.trace, summary: read.summary, dropped: read.dropped} : null;
    const spec = resolveSpec(order, ctx);
    const gaps = spec.filter(f => f.provenance == null).map(f => f.key);
    const contextPublic = {related: ctx.related, work: ctx.work, milestoneId: ctx.milestoneId, milestoneLabel: ctx.milestoneLabel, policy: ctx.policy, assumptions: ctx.assumptions, uncertain: ctx.uncertain, query: ctx.query, absorbed: ctx.absorbed, calendar: ctx.calendar, agent: read ? {model: agent.model, summary: read.summary, trace: read.trace, dropped: read.dropped} : null};
    publish(order, 'context.built', {context: contextPublic});

    // Spec gate: ask for missing technical fields, the CAD, or the demand (what is it for?).
    const missing = [];
    if (!order.entry.cadHash) missing.push({kind: 'cad', text: 'Attach the CAD file (STEP) for this part.'});
    if (gaps.length) missing.push({kind: 'spec', fields: gaps, text: `Confirm: ${gaps.map(k => config.specFields.find(f => f.key === k)?.label || k).join(', ')}.`});
    if (ctx.gaps.length) missing.push({kind: 'demand', text: ctx.gaps[0]});
    if (missing.length) {
      order = store.update(id, order.revision, {state: 'needs_answer', spec, context: {...order.context, ...contextPublic, agentRead}, question: missing[0], decision: null}, 'spec.gap');
      publish(order, 'question', {question: missing[0]});
      return order;
    }

    // Quote on the vendor with the resolved spec and the engineer's CAD.
    const fields = Object.fromEntries(spec.map(f => [f.key, f.value]));
    if (order.entry.fault) fields.__fault = order.entry.fault;
    publish(order, 'quote.started');
    const quote = await vendor.quote({fields, partNumber: order.entry.partNumber || null, cad: {fileName: order.entry.cadFileName, bytes: Buffer.from(order.context.cad.bytes, 'base64'), hash: order.entry.cadHash}});
    publish(order, 'quote.captured', {quote});

    // Decide, in the same world for every option.
    const decision = decide({options: quote.options, quote: {validUntil: quote.validUntil, cutoff: quote.cutoff}, graph: ctx.graph, partNodeId: ctx.partNodeId,
      milestoneId: ctx.milestoneId, orderDate: today(), now: iso(), policy: ctx.policy, uncertain: ctx.uncertain, assumptions: ctx.assumptions, calendar: ctx.calendar});
    decision.text = explain(decision, {milestoneLabel: ctx.milestoneLabel || 'the milestone'});
    const ask = decision.question && decision.question.flips ? {kind: 'fact', nodeId: decision.question.nodeId, owner: decision.question.owner, text: decision.question.text} : null;
    // The agent writes the card, the question and the approver's justification from the computed numbers (checked); templates otherwise.
    if (agent?.enabled) {
      try {
        const written = await agent.write({order, decision, ctx, quote});
        decision.text = written.card; decision.justification = written.justification; decision.writtenBy = agent.model;
        if (ask && written.question) ask.text = written.question;
        publish(order, 'agent.wrote', {card: written.card});
      } catch (e) { log('agent write failed', e); publish(order, 'agent.fallback', {stage: 'write', reason: e.message}); }
    }
    order = store.get(id);
    order = store.update(id, order.revision, {state: ask ? 'needs_answer' : 'recommended', spec, quote, decision, decisionRevision: (order.decisionRevision || 0) + 1,
      context: {...order.context, ...contextPublic, graph: ctx.graph, partNodeId: ctx.partNodeId, agentRead}, question: ask}, 'decision.made');
    publish(order, ask ? 'question' : 'recommended', {question: ask});
    return order;
  }

  /** Answers: spec fields, the CAD, or a fact (a date for a node). Each answer re-solves. */
  async function answer(id, expectedRevision, body) {
    let order = store.get(id);
    const patch = {};
    if (body.fields) {
      const given = Object.entries(body.fields).filter(([, v]) => v != null && v !== '').map(([key, value]) => ({key, value, provenance: 'engineer', sourceRef: 'answer'}));
      patch.spec = [...order.spec.filter(f => !body.fields[f.key]), ...given];
    }
    if (body.cad) { patch.entry = {...order.entry, cadHash: createHash('sha256').update(body.cad.bytes).digest('hex'), cadFileName: body.cad.fileName}; patch.context = {...order.context, cad: {fileName: body.cad.fileName, bytes: body.cad.bytes.toString('base64')}}; }
    if (body.fact) {
      const overrides = {...(order.context?.overrides || {}), [body.fact.nodeId]: {date: body.fact.date, evidence: `answer:${id}:${iso()}`, by: body.fact.by || order.entry.engineer}};
      patch.context = {...(patch.context || order.context), overrides};
    }
    if (body.demand) patch.entry = {...(patch.entry || order.entry), note: `${order.entry.note} ${body.demand}`.trim()};
    order = store.update(id, expectedRevision, {...patch, question: null, state: 'resolving'}, 'answer.received');
    publish(order, 'answer.received');
    return resolve(id, {reread: !!body.cad || !!body.demand});
  }

  /**
   * The engineer argues. The statement is kept, typed, and never silently becomes a fact:
   * only a `fact` carried with it (an explicit date the engineer asserts) changes the plan.
   */
  async function argue(id, expectedRevision, {text, type = 'unresolved', fact = null}) {
    let order = store.get(id);
    if (!text?.trim()) throw new AppError('Say something');
    // The agent reads what the engineer said: a date for a listed input is a fact; anything else is kept as what it is, and answered.
    let reply = null;
    if (agent?.enabled && !fact) {
      try { const r = await agent.interpret({order, text}); type = r.type; fact = r.fact; reply = r.reply; }
      catch (e) { log('agent interpret failed', e); publish(order, 'agent.fallback', {stage: 'interpret', reason: e.message}); }
    }
    const statement = {at: iso(), by: order.entry.engineer, text, type, fact};
    const exchange = [...(order.exchange || []), statement, ...(reply ? [{at: iso(), by: 'Burn', text: reply, type: 'reply'}] : [])];
    order = store.update(id, expectedRevision, {exchange}, 'exchange.added');
    publish(order, 'exchange.added', {statement, reply});
    if (reply) publish(order, 'agent.reply', {text: reply});
    if (fact) return answer(id, order.revision, {fact, by: order.entry.engineer});
    return order;
  }

  /** Okay: freeze the order and send it to Ramp for approval. */
  async function okay(id, expectedRevision, {tier}) {
    let order = store.get(id);
    if (!order.quote || !order.decision) throw new AppError('No quote to approve yet', 409);
    if (order.state !== 'recommended') throw new AppError(order.question?.kind === 'fact' ? 'Answer the open question first; nothing can be okayed while it could change the decision' : `Cannot okay from ${order.state}`, 409);
    const chosen = order.decision.options.find(o => o.tier === tier);
    if (!chosen) throw new AppError('Unknown tier'); if (!chosen.admissible) throw new AppError(`${tier} is not a valid option: ${chosen.why}`, 409);
    const option = order.quote.options.find(o => o.tier === tier);
    const fields = Object.fromEntries(order.spec.map(f => [f.key, f.value]));
    if (order.entry.fault) fields.__fault = order.entry.fault;
    const frozen = {partName: order.entry.name, cadHash: order.entry.cadHash, fields, vendor: order.quote.vendor, quoteId: order.quote.quoteId, tier, priceCents: option.priceCents, currency: config.company.currency,
      total: {includesTax: false, includesShipping: true, varianceCents: 0}};
    order = store.freeze(id, expectedRevision, frozen);
    publish(order, 'order.frozen');

    const justification = `${order.decision.justification || order.decision.text}\n\nAssumptions:\n${order.decision.assumptions.map(a => '- ' + a).join('\n')}${order.quote.cutoff ? `\n\nVendor cutoff: approve by ${order.quote.cutoff} to start production today; after that, +1 business day.` : ''}`;
    const req = await ramp.createRequest({request_owner_id: config.ramp.requestOwnerId || order.entry.engineer, spend_program_id: config.ramp.spendProgramId, currency: frozen.currency,
      name: `${order.entry.name} (${tier}) from Xometry`, line_items: [{description: `${order.entry.name}, ${tier}`, amount: {amount: option.priceCents, currency_code: frozen.currency}, quantity: 1}],
      field_answers: {justification, burn_order_id: id, spec_hash: order.specHash, decision_revision: order.decisionRevision, chosen_tier: tier, recommended_tier: order.decision.recommended?.tier || null},
      specHash: order.specHash, decisionRevision: order.decisionRevision, orderId: id, attachments: [{name: 'justification.txt', mime: 'text/plain', bytes: Buffer.from(justification)}]});
    if (!req.ok) { order = store.update(id, order.revision, {state: 'unresolved', question: {kind: 'ramp', text: `Ramp request failed: ${req.reason}`}}, 'ramp.request.failed'); publish(order, 'ramp.request.failed'); return order; }
    order = store.recordRamp(id, order.revision, {requestId: req.requestId, approvalStatus: req.status}, 'ramp.request.created');
    order = store.update(id, order.revision, {state: 'requested'}, 'ramp.requested');
    publish(order, 'ramp.requested');
    return order;
  }

  /** Inbound Ramp events: authenticated by the client, deduplicated here, reconciled against Ramp's state. */
  async function handleRampEvent(event) {
    if (!event?.id || !event?.type) throw new AppError('Malformed event');
    if (store.seenEvent('ramp', event.id)) return {duplicate: true};
    const findByRequest = rid => store.list().find(o => o.ramp.requestId === rid);
    if (event.type.startsWith('unified_requests.')) {
      const requestId = event.payload?.id || event.payload?.requestId;
      const found = findByRequest(requestId);
      if (!found) return {ignored: 'unknown request'};
      // The event is a hint; Ramp's current state is the authority (events can be late, duplicated or reordered).
      const live = await ramp.getRequest(requestId);
      if (live?.ok === false) return {ignored: live.reason};
      // One atomic step: mark the event processed and apply the state change, with nothing async inside.
      const step = store.processEvent('ramp', event.id, () => {
        let order = store.get(found.id);
        if (order.state !== 'requested') return {ignored: `order is ${order.state}`};
        if (live.status === 'REJECTED' || live.status === 'CANCELLED') {
          order = store.recordRamp(order.id, order.revision, {approvalStatus: live.status}, 'ramp.' + live.status.toLowerCase());
          return {outcome: 'rejected', order: store.update(order.id, order.revision, {state: 'rejected'}, 'ramp.rejected')};
        }
        if (live.status !== 'APPROVED') return {ignored: `request is ${live.status}`};
        if (live.specHash !== order.specHash || live.decisionRevision !== order.decisionRevision) {
          return {outcome: 'stale', order: store.update(order.id, order.revision, {state: 'invalidated', question: {kind: 'stale', text: 'The approval refers to an earlier version of this order; re-approval needed.'}}, 'approval.stale')};
        }
        order = store.recordRamp(order.id, order.revision, {approvalStatus: 'APPROVED'}, 'ramp.approval.recorded');
        return {outcome: 'approved', order: store.update(order.id, order.revision, {state: 'approved'}, 'ramp.approved')};
      });
      if (step.duplicate) return {duplicate: true};
      const r = step.value;
      if (r.order) publish(r.order, r.outcome === 'approved' ? 'ramp.approved' : r.outcome === 'stale' ? 'approval.stale' : 'ramp.rejected');
      if (r.outcome === 'approved') return placeNow(found.id);   // outside the transaction: it talks to the vendor
      return r.order ? {ok: true, outcome: r.outcome} : r;
    }
    if (event.type === 'transactions.cleared') {
      const cardId = event.payload?.card_id || event.payload?.cardId;
      const found = store.list().find(o => o.ramp.cardId === cardId);
      if (!found) return {ignored: 'unknown card'};
      const txnId = event.payload.id || event.payload.transactionId;
      const step = store.processEvent('ramp', event.id, () => {
        const order = store.get(found.id);
        if (order.ramp.transactionIds.includes(txnId)) return order;
        return store.recordRamp(order.id, order.revision, {transactionIds: [...order.ramp.transactionIds, txnId], paymentState: 'charged'}, 'charge.cleared');
      });
      if (step.duplicate) return {duplicate: true};
      publish(step.value, 'charge.cleared');
      return book(found.id, txnId);   // bookkeeping runs outside the transaction and retries on its own
    }
    return {ignored: event.type};
  }

  /** Steps 7–8: revalidate, issue the card, place with every field verified. */
  async function placeNow(id) {
    let order = store.get(id);
    if (order.state !== 'approved') return {ok: false, reason: `order is ${order.state}`};
    // Pre-placement revalidation (architecture §0.4): approval, quote, price, cutoff, and the decision itself.
    const problems = [];
    const live = await ramp.getRequest(order.ramp.requestId);
    if (live?.status !== 'APPROVED' || live.specHash !== order.specHash || live.decisionRevision !== order.decisionRevision) problems.push('the Ramp approval is no longer current');
    if (order.quote?.validUntil && Date.parse(order.quote.validUntil) < Date.parse(iso())) problems.push('the quote has expired');
    const chosen = order.quote?.options.find(o => o.tier === order.frozen.tier);
    if (!chosen || chosen.priceCents !== order.frozen.priceCents) problems.push('the quoted price changed');
    // Material-change rule: re-decide on today's context; a frozen tier that is no longer valid, or a
    // changed recommendation, needs the engineer and approver to look again.
    // Revalidate on the same reading the decision was made on (the agent's graph when it was used), with any engineer-asserted dates.
    const prior = order.context?.agentRead;
    const ctx = buildContext({order, ingest, config, now: iso(), ...(prior ? {graph: prior.graph, evidence: prior.evidence} : {})});
    const fresh = decide({options: order.quote.options, quote: {validUntil: order.quote.validUntil, cutoff: order.quote.cutoff}, graph: ctx.graph, partNodeId: ctx.partNodeId, milestoneId: ctx.milestoneId || order.context?.milestoneId, orderDate: today(), now: iso(), policy: ctx.policy, uncertain: ctx.uncertain, assumptions: ctx.assumptions, calendar: ctx.calendar});
    const frozenNow = fresh.options.find(o => o.tier === order.frozen.tier);
    if (!frozenNow?.admissible) problems.push(`${order.frozen.tier} is no longer a valid option (${frozenNow?.why || 'unknown'})`);
    else if (fresh.recommended && order.decision.recommended && fresh.recommended.tier !== order.decision.recommended.tier) problems.push(`the recommendation changed to ${fresh.recommended.tier} since approval`);
    if (order.quote?.cutoff && Date.parse(order.quote.cutoff) < Date.parse(iso())) publish(order, 'placement.notice', {text: 'The vendor cutoff passed during approval; production starts the next business day.'});
    if (problems.length) {
      order = store.update(id, order.revision, {state: 'invalidated', question: {kind: 'stale', text: `Needs re-approval: ${problems.join('; ')}.`}}, 'placement.invalidated'); publish(order, 'placement.invalidated'); return {ok: false, problems};
    }
    if (!order.ramp.cardId) {
      const card = await ramp.issueCard({user_id: config.ramp.requestOwnerId || order.entry.engineer, limitCents: order.frozen.priceCents + order.frozen.total.varianceCents, allowed_vendors: config.vendor.allowedVendors, lock_date: order.quote.validUntil, orderId: id});
      if (!card.ok) { order = store.recordRamp(id, order.revision, {paymentState: 'failed'}, 'card.failed'); order = store.update(id, order.revision, {state: 'unresolved', question: {kind: 'ramp', text: `Card could not be issued: ${card.reason}`}}, 'card.failed'); publish(order, 'card.failed', {reason: card.reason}); return {ok: false, reason: card.reason}; }
      order = store.recordRamp(id, order.revision, {cardId: card.cardId, cardLast4: card.last4, credentialRef: card.credentialRef, paymentState: 'issued'}, 'card.issued');
      publish(order, 'card.issued');
    }
    publish(order, 'placement.notice', {text: `Placing your Xometry order now (${order.frozen.tier}, $${(order.frozen.priceCents / 100).toLocaleString('en-US')}).`});
    const attempt = store.beginPlacement(id, order.revision);
    publish(store.get(id), 'placement.begun', {attempt});
    let result;
    try {
      result = await vendor.place({spec: {...order.frozen, __specHash: order.specHash}, card: {credentialRef: order.ramp.credentialRef}, attemptId: attempt.id});
    } catch (error) { result = {outcome: 'unknown', reason: error.message}; }
    order = store.endPlacement(attempt.id, result.outcome, {vendorOrderId: result.vendorOrderId, promisedOn: result.promisedOn, reason: result.reason || (result.mismatches ? 'mismatch: ' + result.mismatches.map(m => `${m.field} (expected ${m.expected}, got ${m.actual})`).join(', ') : null)});
    publish(order, `placement.${result.outcome}`, {result});
    if (result.outcome === 'unknown') await reconcile(id, attempt.id);
    return {ok: result.outcome === 'succeeded', result};
  }

  /** placement_unknown: look for the order in the vendor's records before anything else can happen. */
  async function reconcile(id, attemptId = null) {
    let order = store.get(id);
    if (order.state !== 'placement_unknown') return order;
    const since = attemptId ? store.attempts(id).find(a => a.id === attemptId)?.startedAt : null;
    const found = await vendor.findOrder({specHash: order.specHash, since, attemptId});
    if (found.found) { order = store.reconcile(id, {vendorOrderId: found.vendorOrderId, promisedOn: found.promisedOn}); publish(order, 'placement.reconciled'); }
    else publish(order, 'placement.unresolved', {text: 'Vendor response lost and no matching order found yet; a person must confirm before any retry.'});
    if (!found.found && arguments.length > 2 && arguments[2]?.cancel) { order = store.reconcile(id, {cancelled: true, reason: arguments[2].cancel}); publish(order, 'placement.cancelled'); }
    return order;
  }

  /** Step 10: the charge cleared; attach receipt, memo and coding. Retries never touch the purchase. */
  async function book(id, txnId) {
    let order = store.get(id);
    if (!order.ramp.transactionIds.includes(txnId)) order = store.recordRamp(id, order.revision, {transactionIds: [...order.ramp.transactionIds, txnId], paymentState: 'charged'}, 'charge.cleared');
    if (order.bookingState === 'coded') return {ok: true, already: true};
    const memo = `${order.entry.name} (${order.frozen?.tier}) for ${order.context?.milestoneLabel || 'project'}. ${order.decision?.text || ''}`.trim();
    const res = await ramp.book(txnId, {memo, receipt: {name: `xometry-${order.vendorOrder.vendorOrderId || 'order'}.txt`, bytes: Buffer.from(`Xometry order ${order.vendorOrder.vendorOrderId}\n${order.frozen?.tier} $${order.frozen?.priceCents / 100}`)}, coding: {project: order.context?.milestoneLabel || null, burn_order_id: id}});
    order = store.get(id);
    order = store.recordRamp(id, order.revision, {bookingState: res.ok ? 'coded' : 'failed'}, res.ok ? 'booked' : 'booking.failed');
    publish(order, res.ok ? 'booked' : 'booking.failed');
    return {ok: res.ok};
  }

  ramp.onEvent(handleRampEvent);
  /** New context arrived (a sync, a live message): every order still deciding is re-solved against it. */
  async function refresh() {
    const open = store.list().filter(o => ['recommended', 'needs_answer'].includes(o.state) && o.question?.kind !== 'cad' && o.question?.kind !== 'spec');
    const out = [];
    for (const o of open) { try { out.push(await resolve(o.id)); } catch (e) { log('refresh failed', e); } }
    return out;
  }
  return {enter, resolve, answer, argue, okay, handleRampEvent, placeNow, reconcile, book, refresh, bus, get: store.get, list: store.list, events: store.events};
}
