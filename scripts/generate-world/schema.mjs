// Machine-readable schema for fixtures/world/world.json and answers.json.
// Field reference with meanings and examples: fixtures/world/SCHEMA.md.
// Type strings: str num int bool date time ftime any obj
//   date  = YYYY-MM-DD
//   time  = ISO 8601 with the correct Pacific offset, inside meta.window
//   ftime = same format, may fall after the window (deliveries, first use)
//   enum:<name>   value from ENUMS[name]
//   ref:<coll>    id in that collection; ref:any = any id in the world
//   hist:<type>   history list [{value, effective, known_at, by, where, ...}]
//   [<type>]      array of that type
// Suffix "!" = required and non-null; "?" = optional (may be absent or null).
// An object spec nests fields.

export const SCHEMA_VERSION = '1.0';

export const ENUMS = {
  hidden_reason: [
    'genuine_gain', 'test_slot_cliff', 'no_gain_other_input_later',
    'pressure_manager_or_demo', 'ordered_late', 'insurance_or_spare',
    'personal_habit', 'budget_squeeze', 'cheap_default',
  ],
  claim_kind: ['needs', 'eta', 'done', 'blocked', 'owner', 'need_earlier', 'substitute', 'duration', 'stock'],
  event_kind: ['crumb', 'background'],
  background_topic: ['tradeoff', 'test_result', 'failure', 'debate', 'status', 'logistics', 'question', 'ack', 'social', 'offtopic'],
  source: ['slack', 'jira', 'meeting', 'calendar'],
  ticket_field: ['created', 'description', 'comment', 'status', 'due_date'],
  tier: ['economy', 'standard', 'expedite', 'international_economy'],
  link_quality: ['clean_id', 'alias_only', 'never_discussed'],
  ref_mode: ['id', 'part_number', 'alias', 'vague'],
  truth_status: ['true', 'stale', 'wrong'],
  pressure: ['low', 'elevated', 'high'],
  time_band: ['0-1', '1-3', '3-7', '7-14', '14-30'],
  ticket_status: ['To Do', 'In Progress', 'Blocked', 'In Review', 'Done'],
  ticket_type: ['Task', 'Bug', 'Epic', 'Story', 'Sub-task'],
  ticket_priority: ['Highest', 'High', 'Medium', 'Low'],
  ticket_link: ['blocks', 'is_blocked_by', 'relates_to'],
  meeting_type: [
    'supply_chain_sync', 'supply_chain_mech', 'program_review', 'design_review',
    'standup', 'build_readiness', 'gate_review', 'vendor_call', 'leadership', 'all_hands', 'test_review',
  ],
  note_taker: ['fireflies', 'granola', 'zoom_ai', 'manual_doc', 'none'],
  rsvp: ['accepted', 'tentative', 'declined', 'needs_action'],
  payment_method: ['card', 'bill_net30', 'po_wire', 'paypal', 'carrier_account'],
  xometry_status: [
    'quote', 'order_placed', 'dfm_review', 'dfm_action_required', 'in_production',
    'quality_inspection', 'shipped', 'delivered', 'cancelled', 'refunded',
  ],
  other_status: ['placed', 'backordered', 'partially_shipped', 'shipped', 'delivered', 'cancelled', 'refunded'],
  order_type: ['xometry_cnc', 'other'],
  vendor_category: [
    'cnc_xometry', 'fasteners', 'amazon_consumables', 'electronics', 'pcb', 'other_custom_fab',
    'motors_gearing_bearings', 'sensors', 'batteries_power', 'tools_test_equipment', 'raw_stock', 'shipping', 'saas',
  ],
  part_kind: ['robot_part', 'test_hardware'],
  process: ['cnc_milling_3axis', 'cnc_milling_5axis', 'cnc_turning', 'cnc_mill_turn'],
  inspection_result: ['pass', 'fail', 'partial', 'skipped'],
  working_state: ['design', 'build', 'bring_up', 'partly_working', 'working', 'blocked'],
  work_status: ['not_started', 'in_progress', 'blocked', 'done'],
  test_result: ['not_run', 'pass', 'fail', 'partial', 'aborted'],
  milestone_kind: ['build', 'test', 'gate', 'demo', 'review'],
  hardness: ['hard', 'soft'],
  value_policy_type: ['per_day', 'curve', 'none'],
  edge_kind: ['requires_all', 'alternative'],
  reveal: ['revealed', 'hinted', 'never'],
  deliverable_kind: ['motor', 'gearbox', 'pcb', 'pcba', 'firmware', 'sensor', 'cells', 'harness', 'other'],
  booking_status: ['confirmed', 'tentative', 'cancelled'],
  resource_kind: ['chamber', 'metrology', 'bench', 'bay', 'machine'],
  channel_type: ['public', 'private', 'dm', 'mpim'],
  order_weight: ['none', 'light', 'medium', 'heavy'],
  ordering_habit: ['none', 'over_expedites', 'always_standard', 'last_minute', 'batches_orders', 'budget_conscious'],
  style_case: ['lower', 'mixed', 'proper'],
  style_punctuation: ['none', 'light', 'full'],
  style_level: ['none', 'rare', 'some', 'lots'],
  style_length: ['terse', 'medium', 'long'],
  style_hedging: ['low', 'medium', 'high'],
  holiday_observance: ['full', 'partial', 'worked'],
  ramp_instrument: ['card', 'bill'],
  ramp_kind: ['charge', 'split', 'refund', 'decline'],
  ramp_state: ['PENDING', 'CLEARED', 'DECLINED'],
};

const hist = (t) => `hist:${t}`;

const booking = {
  id: 'str!', start: 'ftime!', end: 'ftime!', test: 'ref:tests?', by: 'ref:people!',
  status: 'enum:booking_status!', conflict_with: '[str]?',
};

export const SPEC = {
  meta: {
    schema_version: 'str!', seed: 'int!', company: 'str!', time_zone: 'str!',
    window: { start: 'time!', end: 'time!' },
    demo_now: 'time!',
    periods: {
      lead_in: { start: 'date!', end: 'date!' },
      train: { start: 'date!', end: 'date!' },
      test: { start: 'date!', end: 'date!' },
    },
    context_first_pass: { start: 'date!', end: 'date!' },
    holidays: [{ date: 'date!', name: 'str!', observance: 'enum:holiday_observance!', in_window: 'bool!' }],
    business_hours: { days: '[int]!', start: 'str!', end: 'str!', supplier_email_start: 'str!', supplier_email_end: 'str!' },
  },
  teams: {
    id: 'str!', name: 'str!', headcount: 'int!', lead: 'ref:people!', members: '[ref:people]!',
    channels: '[ref:channels]!', jira_project: 'ref:jira_projects?', department: 'str!',
  },
  people: {
    id: 'str!', name: 'str!', display_name: 'str!', title: 'str!', team: 'ref:teams!',
    manager: 'ref:people?', email: 'str!', slack_id: 'str!', jira_account_id: 'str!',
    ramp_user_id: 'str!', ramp_card_ids: '[str]!', start_date: 'date!', end_date: 'date?',
    ooo: [{ start: 'date!', end: 'date!', reason: 'str!' }],
    orders: { weight: 'enum:order_weight!', habit: 'enum:ordering_habit!' },
    style: {
      case: 'enum:style_case!', punctuation: 'enum:style_punctuation!', typos: 'enum:style_level!',
      emoji: 'enum:style_level!', length: 'enum:style_length!', hedging: 'enum:style_hedging!', quirks: '[str]?',
    },
    chattiness: 'num!', lurker: 'bool!', authority_on: '[str]!',
  },
  assemblies: {
    id: 'str!', name: 'str!', owner: 'ref:people!', team: 'ref:teams!',
    working_state: hist('enum:working_state') + '!', revision: hist('str') + '!',
    jira_project: 'ref:jira_projects!', channel: 'ref:channels!', project_code: 'str!',
    parent: 'ref:assemblies?', description: 'str?',
  },
  parts: {
    id: 'str!', name: 'str!', part_number: 'str!', cad_file: 'str!', aliases: '[str]!',
    belongs_to: 'ref:any!', kind: 'enum:part_kind!', material: 'str!', finish: 'str!',
    tolerance: 'str!', process: 'enum:process!', typical_qty: 'int!', vendor: 'ref:vendors!',
    revisions: hist('str') + '!', price_hint_usd: 'num?',
  },
  test_rigs: {
    id: 'str!', name: 'str!', location: 'str!', owner: 'ref:people!', needs: '[ref:any]!',
    bookings: [booking],
  },
  resources: {
    id: 'str!', name: 'str!', kind: 'enum:resource_kind!', location: 'str!', owner: 'ref:people!',
    needs: '[ref:any]!', bookings: [booking],
  },
  tests: {
    id: 'str!', name: 'str!', assembly: 'ref:assemblies!', rig: 'ref:test_rigs?', resources: '[ref:resources]!',
    owner: 'ref:people!', milestone: 'ref:milestones?', duration_true_days: 'num!',
    duration_estimate_days: '[num]!', planned_date: hist('date') + '!',
    actual_start: 'ftime?', actual_end: 'ftime?', result: 'enum:test_result?',
  },
  deliverables: {
    id: 'str!', name: 'str!', kind: 'enum:deliverable_kind!', owner: 'ref:people!',
    assembly: 'ref:assemblies?', vendor: 'ref:vendors?', order: 'ref:orders?',
    eta: hist('date') + '!', true_arrival: 'date?',
  },
  work_items: {
    id: 'str!', name: 'str!', owner: 'ref:people!', assembly: 'ref:assemblies!',
    duration_true_days: 'num!', duration_estimate_days: '[num]?', blocked_by: '[ref:any]!',
    status: hist('enum:work_status') + '!',
  },
  milestones: {
    id: 'str!', name: 'str!', owner: 'ref:people!', kind: 'enum:milestone_kind!', hardness: 'enum:hardness!',
    assemblies: '[ref:assemblies]!', date: hist('date') + '!', value_policy: hist('obj') + '!',
    burst_weeks: 'int?',
  },
  edges: {
    id: 'str!', from: 'ref:any!', to: 'ref:any!', kind: 'enum:edge_kind!', group: 'str?',
    reveal: 'enum:reveal!', revealed_by: '[ref:events]!', note: 'str?',
  },
  storylines: {
    id: 'str!', name: 'str!', team: 'ref:teams!', topic: 'str!', people: '[ref:people]!',
    start: 'date!', end: 'date!', beats: [{ week: 'date!', summary: 'str!' }],
  },
  channels: {
    id: 'str!', name: 'str!', slack_id: 'str!', purpose: 'str!', type: 'enum:channel_type!',
    members: '[ref:people]!', bots: '[str]!', base_rate_per_day: 'num!', on_topic_share: 'num!',
    purchasing_relevant: 'bool!', assembly: 'ref:assemblies?',
  },
  jira_projects: {
    id: 'str!', name: 'str!', lead: 'ref:people!', team: 'ref:teams!', assemblies: '[ref:assemblies]!',
  },
  meeting_series: {
    id: 'str!', name: 'str!', type: 'enum:meeting_type!', rrule: 'str!', start_local: 'str!',
    duration_min: 'int!', organizer: 'ref:people!', attendees: '[ref:people]!',
    optional_attendees: '[ref:people]?', note_taker: 'enum:note_taker!', recorded: 'bool!', conference: 'str?',
  },
  meetings: {
    id: 'str!', name: 'str!', series: 'ref:meeting_series?', type: 'enum:meeting_type!', start: 'time!',
    scheduled_min: 'int!', actual_min: 'int!', invited: '[ref:people]!', present: '[ref:people]!',
    late_joiners: '[ref:people]?', external: '[str]?', note_taker: 'enum:note_taker!', recorded: 'bool!',
    storylines: '[ref:storylines]!', rsvp: 'obj!', moved_from: 'time?', cancelled: 'bool?',
  },
  tickets: {
    id: 'str!', project: 'ref:jira_projects!', type: 'enum:ticket_type!', brief: 'str!',
    assembly: 'ref:assemblies?', work_item: 'ref:work_items?', order: 'ref:orders?', test: 'ref:tests?',
    reporter: 'ref:people!', assignee: 'ref:people?', labels: '[str]!', components: '[str]?',
    priority: 'enum:ticket_priority!', parent: 'ref:tickets?', created: 'time!',
    status: hist('enum:ticket_status') + '!', due_date: hist('date') + '!',
    links: [{ type: 'enum:ticket_link!', key: 'ref:tickets!' }],
  },
  vendors: {
    id: 'str!', name: 'str!', category: 'enum:vendor_category!', descriptors: '[str]!',
    payment_method: 'enum:payment_method!', terms: 'str?', mcc: 'str?', local: 'bool!',
    shipping: { carrier: 'str!', transit_days: '[num]!', splits_shipments: 'bool!', cutoff_local: 'str?' },
  },
  finance: {
    gl_accounts: [{ id: 'str!', name: 'str!' }],
    project_codes: [{ code: 'str!', name: 'str!', assembly: 'ref:assemblies?' }],
    ramp_departments: [{ id: 'str!', name: 'str!', teams: '[ref:teams]!' }],
    approval: {
      rule: 'str!', auto_approve_under_usd: 'num!', second_approver_over_usd: 'num!',
      second_approver: 'ref:people!',
    },
  },
  orders_xometry: {
    id: 'str!', type: 'enum:order_type!', vendor: 'ref:vendors!', quote_id: 'str!', order_number: 'str!',
    lines: [{ part: 'ref:parts!', revision: 'str!', quantity: 'int!', unit_price_usd: 'num!' }],
    tiers: [{
      tier: 'enum:tier!', subtotal_usd: 'num!', lead_business_days: 'int!',
      est_ship: 'date!', est_delivery: 'date!',
    }],
    chosen_tier: 'enum:tier!', quoted_at: 'time!', quote_expires: 'date!',
    requester: 'ref:people!', placer: 'ref:people!', approver: 'ref:people!', approved_at: 'time!',
    placed_at: 'time!', subtotal_usd: 'num!', shipping_usd: 'num!', tax_usd: 'num!', total_usd: 'num!',
    promised_date: 'date!', status: hist('enum:xometry_status') + '!', delivered_at: 'ftime?',
    carrier: 'str?', tracking: 'str?',
    inspection: { result: 'enum:inspection_result!', at: 'ftime!', by: 'ref:people?' },
    first_use: { at: 'ftime!', recorded: 'bool!', evidence: 'ref:events?' },
    feeds_test: 'ref:tests?', feeds_milestone: 'ref:milestones?', need_by_believed: 'date?',
    link_quality: 'enum:link_quality!', cancelled: 'bool!', remade_from: 'ref:orders?',
    ramp_transaction_ids: '[ref:ramp_transactions]!', descriptor: 'str!',
    memo_present: 'bool!', receipt_present: 'bool!', certifications: '[str]?',
  },
  orders_other: {
    id: 'str!', type: 'enum:order_type!', vendor: 'ref:vendors!', category: 'enum:vendor_category!',
    description: 'str!', amount_usd: 'num!', placed_at: 'time!', by: 'ref:people!',
    payment_method: 'enum:payment_method!', status: 'enum:other_status!', delivered_at: 'ftime?',
    ramp_transaction_ids: '[ref:ramp_transactions]!', deliverable: 'ref:deliverables?', test: 'ref:tests?',
    recurring: 'bool?',
  },
  ramp_transactions: {
    id: 'str!', order: 'ref:orders?', instrument: 'enum:ramp_instrument!', kind: 'enum:ramp_kind!',
    state: 'enum:ramp_state!', amount_usd: 'num!', user_transaction_time: 'time!', settlement_date: 'date?',
    card_id: 'str?', card_holder: 'ref:people!', merchant_name: 'str!', merchant_descriptor: 'str!',
    mcc: 'str?', memo_present: 'bool!', receipt_present: 'bool!', original_transaction_id: 'ref:ramp_transactions?',
    department: 'str?', gl_account: 'str?', project_code: 'str?',
  },
  events: {
    id: 'str!', known_at: 'time!', source: 'enum:source!',
    where: {
      channel: 'ref:channels?', thread_of: 'ref:events?', ticket: 'ref:tickets?',
      ticket_field: 'enum:ticket_field?', meeting: 'ref:meetings?', calendar: 'str?',
    },
    by: 'ref:people!', kind: 'enum:event_kind!', topic: 'enum:background_topic?',
    claim: { kind: 'enum:claim_kind!', subject: 'ref:any!', value: 'any!', effective: 'any?', for_use: 'ref:any?' },
    refs: [{ id: 'ref:any!', mode: 'enum:ref_mode!' }],
    truth: 'enum:truth_status!', corrects: 'ref:events?', contradicts: '[ref:events]?',
    pressure: 'enum:pressure?', storyline: 'ref:storylines?', orders: '[ref:orders]!', brief: 'str!',
  },
  demo: {
    part: 'ref:parts!', revision: 'str!', quantity: 'int!', requester: 'ref:people!', placed_at: 'time!',
    quote: {
      quote_id: 'str!', captured_at: 'time!', valid_until: 'date!',
      tiers: [{ tier: 'enum:tier!', price_usd: 'num!', ready_working_day: 'int!', ready_date: 'date!' }],
    },
    test: 'ref:tests!', test_duration_working_days: 'int!', inputs: '[ref:any]!',
    motor: {
      deliverable: 'ref:deliverables!', owner: 'ref:people!', ready_working_day: 'int!', ready_date: 'date!',
      stated_by: 'ref:people!', stated_at: 'time!', uncertain_range_days: '[int]!',
    },
    milestone: 'ref:milestones!', target_working_day: 'int!',
    policy: { type: 'enum:value_policy_type!', usd_per_day: 'num!', set_by: 'ref:people!' },
    context_window: { start: 'time!', end: 'time!' },
    cases: 'obj!',
    live_changes: [{
      id: 'str!', case: 'str!', at: 'time!', source: 'enum:source!', by: 'ref:people!',
      where: 'str!', claim: 'obj!', brief: 'str!',
    }],
  },
};

export const ANSWERS_SPEC = {
  orders: {
    order: 'ref:orders!', hidden_reason: 'enum:hidden_reason!', true_need_date: 'date?',
    true_links: '[ref:edges]!', true_pressure: 'obj!',
    tier_outcomes: [{ tier: 'enum:tier!', ready_date: 'date!', gated_date: 'date?', days_gained: 'num!' }],
    expedite_helped: 'bool?', crumbs: '[ref:events]!', never_revealed: '[str]!',
  },
  assembly_weeks: {
    assembly: 'ref:assemblies!', week_start: 'date!', true_progress: 'num!', true_pressure: 'enum:pressure!',
  },
};

// Top-level arrays in world.json, in file order. Orders are split by type for validation only.
export const COLLECTIONS = [
  'teams', 'people', 'assemblies', 'parts', 'test_rigs', 'resources', 'tests', 'deliverables',
  'work_items', 'milestones', 'edges', 'storylines', 'channels', 'jira_projects', 'meeting_series',
  'meetings', 'tickets', 'vendors', 'orders', 'ramp_transactions', 'events',
];

// ---- time helpers (US Pacific rules, any year) ----
const TIME_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?([+-]\d{2}:\d{2})$/;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function nthSunday(year, month, n) {
  const dow = new Date(Date.UTC(year, month, 1)).getUTCDay();
  return 1 + ((7 - dow) % 7) + 7 * (n - 1);
}

export function pacificOffset(utcMs) {
  const y = new Date(utcMs).getUTCFullYear();
  const start = Date.UTC(y, 2, nthSunday(y, 2, 2), 10); // 02:00 PST
  const end = Date.UTC(y, 10, nthSunday(y, 10, 1), 9); // 02:00 PDT
  return utcMs >= start && utcMs < end ? '-07:00' : '-08:00';
}

export function isDate(s) {
  if (typeof s !== 'string') return false;
  const m = DATE_RE.exec(s);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

// Returns null if fine, else a reason string.
export function checkTime(s) {
  if (typeof s !== 'string') return 'not a string';
  const m = TIME_RE.exec(s);
  if (!m) return 'not ISO 8601 with an offset';
  if (!isDate(s.slice(0, 10))) return 'invalid calendar date';
  const ms = Date.parse(s);
  if (Number.isNaN(ms)) return 'unparseable';
  const want = pacificOffset(ms);
  if (m[7] !== want) return `offset ${m[7]} should be ${want} (Pacific)`;
  return null;
}

// Pacific local ISO string for a UTC instant (used by simulator/plan code).
export function toPacificIso(utcMs) {
  const off = pacificOffset(utcMs);
  const local = new Date(utcMs + (off === '-07:00' ? -7 : -8) * 3600e3);
  return local.toISOString().slice(0, 19) + off;
}
