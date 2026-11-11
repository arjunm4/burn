// TEMPORARY in-memory RampClient (mock mode) matching server/contracts.js, so the API and
// screens can be built before Codex's server/ramp/ lands. Uses Ramp's field names; delivers
// events in-process to the registered handler. Delete when the real mock lands.
import {randomUUID} from 'node:crypto';

export function createMemoryRamp() {
  const requests = new Map(), cards = new Map(), txns = new Map(), docs = new Map();
  let handler = async () => {};
  const emit = async (type, payload) => { await handler({id: 'evt_' + randomUUID().slice(0, 8), type, payload}); };
  return {
    describe: () => ({mode: 'mock', capabilities: {purchaseRequests: true, vaultCards: true, itemReceipts: false, webhooks: true}}),
    async createRequest(req) {
      const id = 'req_' + randomUUID().slice(0, 8);
      requests.set(id, {...req, id, status: 'PENDING', created_at: new Date().toISOString()});
      return {ok: true, requestId: id, status: 'PENDING'};
    },
    async getRequest(id) { const r = requests.get(id); return r ? {status: r.status, approvedAt: r.approvedAt, specHash: r.specHash} : {status: 'CANCELLED'}; },
    async issueCard(card) {
      const id = 'card_' + randomUUID().slice(0, 8);
      cards.set(id, {...card, id, spending_restrictions: {interval: 'TOTAL', limit: card.limitCents / 100, allowed_vendors: card.allowed_vendors, lock_date: card.lock_date}, last4: String(Math.floor(1000 + Math.random() * 9000))});
      return {ok: true, cardId: id, last4: cards.get(id).last4, credentialRef: 'vault:' + id};
    },
    async book(txnId, doc) { if (!txns.has(txnId)) return {ok: false, reason: 'transaction not found'}; docs.set(txnId, {...(docs.get(txnId) || {}), ...doc}); return {ok: true}; },
    onEvent(h) { handler = h; },
    async simulate() {
      return {
        approve: async id => { const r = requests.get(id); r.status = 'APPROVED'; r.approvedAt = new Date().toISOString(); await emit('unified_requests.approved', {id, specHash: r.specHash, decisionRevision: r.decisionRevision}); },
        reject: async id => { const r = requests.get(id); r.status = 'REJECTED'; await emit('unified_requests.rejected', {id}); },
        charge: async (cardId, amountCents) => { const id = 'txn_' + randomUUID().slice(0, 8); txns.set(id, {cardId, amountCents}); await emit('transactions.cleared', {id, card_id: cardId, amount: amountCents / 100}); return id; },
        redeliver: async (type, payload) => emit(type, payload),
      };
    },
    _records: {requests, cards, txns, docs},
  };
}
