// Shared contracts for the v9 build. Every module below imports these shapes (as JSDoc
// types) rather than inventing its own, so the order store, decision core, Ramp client,
// vendor provider and UI agree on one vocabulary. Runtime helpers at the bottom are the
// only executable code here.
//
// Ownership: Codex builds `server/orders/` (OrderStore) and `server/ramp/` (RampClient
// mock + sandbox). Claude builds `src/decision/`, `server/vendors/` (VendorProvider),
// the HTTP API and the screens. Change a contract here first, then the code.

import {createHash} from 'node:crypto';

/**
 * A technical field of the order, with where its value came from. Values never come
 * from chatter: provenance is one of the listed sources, or the field is a gap.
 * @typedef {object} SpecField
 * @property {string} key            e.g. 'material', 'finish', 'tolerance', 'quantity', 'revision', 'inspection', 'shipTo'
 * @property {string|number|null} value
 * @property {'engineer'|'default'|'cad'|'quote'|null} provenance   null = gap, must be asked
 * @property {string} [sourceRef]    document id, default-policy id or CAD hash backing the value
 */

/**
 * The frozen order: exactly what will be bought. Hashed by specHash().
 * @typedef {object} OrderSpec
 * @property {string} partName
 * @property {string} cadHash        sha256 of the uploaded CAD file
 * @property {Record<string, string|number>} fields   key -> value, every SpecField resolved
 * @property {string} vendor         'xometry'
 * @property {string} quoteId        vendor quote id
 * @property {string} tier           chosen QuoteOption.tier
 * @property {number} priceCents     total price of that tier, in cents
 * @property {string} currency       'USD'
 * @property {{includesTax: boolean, includesShipping: boolean, varianceCents: number}} total
 */

/**
 * What the vendor offered, captured once. completeness says whether every tier was read.
 * @typedef {object} QuoteSnapshot
 * @property {string} vendor
 * @property {string} quoteId
 * @property {string} configurationRevision   vendor-side config version, if any
 * @property {string} capturedAt              ISO
 * @property {string|null} validUntil         ISO
 * @property {string|null} cutoff             ISO: order by this to start production today
 * @property {'complete'|'partial'} completeness
 * @property {QuoteOption[]} options
 * @property {string} source                  'headless' | 'fake' | 'import'
 */

/**
 * @typedef {object} QuoteOption
 * @property {string} tier            vendor's name, e.g. 'Standard', 'Expedited'
 * @property {number} priceCents
 * @property {number} mfgDays         business days of production
 * @property {number} shipDays        calendar days of shipping
 * @property {string} readyOn         ISO date the part is usable on site (vendor promise + receiving)
 */

/**
 * Procurement states. Exits are terminal except placement_unknown, which must be
 * reconciled (to placed or cancelled) by a human or a vendor confirmation.
 */
export const ORDER_STATES = [
  'entered', 'resolving', 'needs_answer', 'recommended', 'specified',
  'requested', 'approved', 'placing', 'placed', 'delivered', 'in_use',
  'rejected', 'cancelled', 'unresolved', 'superseded', 'invalidated', 'placement_unknown',
];

/** Payment and booking run beside procurement, each retryable without touching the purchase. */
export const PAYMENT_STATES = ['none', 'requested', 'issued', 'charged', 'failed'];
export const BOOKING_STATES = ['pending', 'receipt_attached', 'memo_added', 'coded', 'failed'];

/**
 * @typedef {object} Order
 * @property {string} id
 * @property {number} revision                 bumps on every mutation; mutations carry expectedRevision
 * @property {string} state                    one of ORDER_STATES
 * @property {string} paymentState             one of PAYMENT_STATES
 * @property {string} bookingState             one of BOOKING_STATES
 * @property {{name: string, note: string, cadHash: string|null, cadFileName: string|null, engineer: string, enteredAt: string}} entry
 * @property {SpecField[]} spec                 technical fields with provenance (gaps have provenance null)
 * @property {QuoteSnapshot|null} quote
 * @property {object|null} decision             DecisionResult (src/decision), frozen with its snapshot hash
 * @property {number|null} decisionRevision
 * @property {OrderSpec|null} frozen            set at Okay
 * @property {string|null} specHash
 * @property {{requestId: string|null, approvalStatus: string|null, cardId: string|null, transactionIds: string[], receiptId: string|null}} ramp
 * @property {{vendorOrderId: string|null, promisedOn: string|null}} vendorOrder
 * @property {string} createdAt
 * @property {string} updatedAt
 */

/**
 * A placement attempt is persisted BEFORE the external click. Outcome 'unknown' means
 * the vendor's answer was lost; the order goes to placement_unknown and no new attempt
 * is allowed until reconcile() resolves it.
 * @typedef {object} PlacementAttempt
 * @property {string} id
 * @property {string} orderId
 * @property {number} n                        1-based, serialized per order
 * @property {string} specHash
 * @property {number} decisionRevision
 * @property {string} startedAt
 * @property {'succeeded'|'failed'|'unknown'|'blocked'|null} outcome
 * @property {string|null} vendorOrderId
 * @property {string|null} reason              mismatch detail, error, etc.
 * @property {string|null} finishedAt
 */

/**
 * OrderStore (Codex). All mutations are transactional, take expectedRevision, and append
 * to an immutable event log. Illegal transitions throw AppError(409).
 *
 * @typedef {object} OrderStore
 * @property {(entry: Order['entry']) => Order} create
 * @property {(id: string) => Order} get
 * @property {() => Order[]} list
 * @property {(id: string, expectedRevision: number, patch: Partial<Order>, event: string) => Order} update
 *   Generic patch with state validation; `event` names what happened ('spec.confirmed', 'okay', ...).
 * @property {(id: string, expectedRevision: number, frozen: OrderSpec) => Order} freeze
 *   Sets frozen + specHash, state -> 'specified'.
 * @property {(id: string, expectedRevision: number) => PlacementAttempt} beginPlacement
 *   Throws 409 unless state is 'approved' and no attempt is open; state -> 'placing'.
 * @property {(attemptId: string, outcome: PlacementAttempt['outcome'], detail: {vendorOrderId?: string, promisedOn?: string, reason?: string}) => Order} endPlacement
 *   succeeded -> 'placed'; failed/blocked -> back to 'approved' with reason; unknown -> 'placement_unknown'.
 * @property {(id: string, resolution: {vendorOrderId: string, promisedOn?: string} | {cancelled: true, reason: string}) => Order} reconcile
 *   Only from placement_unknown.
 * @property {(id: string, expectedRevision: number, patch: Partial<Order['ramp']> & {paymentState?: string, bookingState?: string}, event: string) => Order} recordRamp
 * @property {(id: string) => Array<{at: string, event: string, revision: number, detail: object}>} events
 * @property {(source: string, externalId: string) => boolean} seenEvent
 *   Idempotency for inbound webhooks: true if already processed (and records it otherwise).
 * @property {() => void} close
 */

/**
 * RampClient (Codex). Same interface for 'mock' and 'sandbox'; field names follow Ramp's
 * API (spend_program_id, request_owner_id, field_answers, spending_restrictions, ...).
 * Every method returns a typed outcome and never throws on a provider "no" — it returns
 * {ok:false, reason, capability?} so the caller can block or declare a simulation.
 *
 * @typedef {object} RampClient
 * @property {() => {mode: 'mock'|'sandbox', capabilities: {purchaseRequests: boolean, vaultCards: boolean, itemReceipts: boolean, webhooks: boolean}}} describe
 * @property {(req: {request_owner_id: string, spend_program_id: string, currency: string, name: string, line_items: object[], field_answers: object, specHash: string, decisionRevision: number, attachments: Array<{name: string, mime: string, bytes: Buffer}>}) => Promise<{ok: true, requestId: string, status: string} | {ok: false, reason: string}>} createRequest
 * @property {(requestId: string) => Promise<{status: 'PENDING'|'APPROVED'|'REJECTED'|'CANCELLED', approvedAt?: string, specHash?: string}>} getRequest
 * @property {(card: {user_id: string, limitCents: number, allowed_vendors: string[], lock_date: string, orderId: string}) => Promise<{ok: true, cardId: string, last4: string, credentialRef: string} | {ok: false, reason: string, capability: string}>} issueCard
 *   credentialRef is an opaque one-time handle; the PAN is fetched by the vendor provider
 *   from the server-side vault, never by the UI or the model.
 * @property {(txnId: string, doc: {receipt?: {name: string, bytes: Buffer}, memo?: string, coding?: object}) => Promise<{ok: boolean, reason?: string}>} book
 * @property {(handler: (event: {id: string, type: string, payload: object}) => Promise<void>) => void} onEvent
 *   Mock delivers events by POSTing to our own webhook route; sandbox verifies X-Ramp-Signature.
 * @property {() => Promise<{approve: (requestId: string) => Promise<void>, reject: (requestId: string) => Promise<void>, charge: (cardId: string, amountCents: number) => Promise<string>}>} [simulate]
 *   Mock only: the "demo.ramp.com ⌘J" stand-in.
 */

/**
 * VendorProvider (Claude). 'fake' (local fake Xometry site) and 'headless' (Playwright
 * against xometry.com, company account). Declares what it can verify.
 *
 * @typedef {object} VendorProvider
 * @property {() => {vendor: string, mode: 'fake'|'headless', capabilities: {quote: boolean, place: boolean, status: boolean, teamspaceReuse: boolean}}} describe
 * @property {(input: {fields: Record<string, string|number>, cad: {fileName: string, bytes: Buffer, hash: string}}) => Promise<QuoteSnapshot>} quote
 * @property {(input: {spec: OrderSpec, card: {credentialRef: string}, attemptId: string}) => Promise<{outcome: 'succeeded', vendorOrderId: string, promisedOn: string, verified: Record<string, boolean>} | {outcome: 'blocked', mismatches: Array<{field: string, expected: unknown, actual: unknown}>} | {outcome: 'failed', reason: string} | {outcome: 'unknown', reason: string}>} place
 *   Reads back every field and compares with spec before the final click.
 * @property {(vendorOrderId: string) => Promise<{status: string, promisedOn: string|null, tracking: string|null}>} status
 * @property {(input: {specHash: string, since: string}) => Promise<{found: false} | {found: true, vendorOrderId: string, promisedOn: string}>} findOrder
 *   Used by reconcile(): look for an order matching the spec in vendor history.
 */

/**
 * DecisionResult (Claude, src/decision). Pure function of the planning snapshot.
 * @typedef {object} DecisionResult
 * @property {string} snapshotHash
 * @property {Array<{tier: string, admissible: boolean, why?: string, finishOn: string|null, deltaDays: number|null, extraCents: number, breakEvenCentsPerDay: number|null}>} options
 * @property {{tier: string, basis: 'dominance'|'policy'|'economics'} | null} recommended   null = nothing can be recommended yet
 * @property {string[]} assumptions           plain sentences with the age of each fact
 * @property {string|null} switching          "Standard wins if the motor slips to day 10 or later"
 * @property {{owner: string, text: string, flips: boolean} | null} question
 * @property {string[]} unknowns              node ids whose dates are unknown
 */

/** Canonical hash of an OrderSpec: stable key order, so the same spec always hashes the same. */
export function specHash(spec) {
  const canonical = JSON.stringify(spec, Object.keys(flatten(spec)).sort());
  return createHash('sha256').update(canonical).digest('hex');
}
function flatten(o, prefix = '', out = {}) {
  for (const [k, v] of Object.entries(o)) {
    out[k] = true;
    if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, prefix + k + '.', out);
  }
  return out;
}

export class AppError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
