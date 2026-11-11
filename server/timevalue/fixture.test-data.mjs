// Small hand-made company fixture shared by the time-value graph tests (C). Not a test file itself.
// Shapes follow the contracts in docs/build/time-value-impl.md (settings.json, sources.mjs docs).

export const NOW = '2026-11-10T10:30:00-08:00';

export const settings = {
  generated_from: 'hand-made test fixture', demo_now: NOW, time_zone: 'America/Los_Angeles',
  holidays: [{ date: '2026-11-26', name: 'Thanksgiving', observance: 'full' }, { date: '2026-11-27', name: 'Day after Thanksgiving', observance: 'full' }],
  people: [
    { id: 'p-arjun', name: 'Arjun Venkatesan', email: 'arjun@flintlockrobotics.com', slack_id: 'U07FLK0ARJN', team: 't-actuators', title: 'Actuators Lead', manager: 'p-ingrid' },
    { id: 'p-owen', name: 'Owen Halloran', email: 'owen@flintlockrobotics.com', slack_id: 'U07FLK0OWEN', team: 't-actuators', title: 'Mechanical Engineer, Actuators', manager: 'p-arjun' },
    { id: 'p-samir', name: 'Samir Khoury', email: 'samir@flintlockrobotics.com', slack_id: 'U07FLK0SAMI', team: 't-supply', title: 'Supply chain', manager: null },
    { id: 'p-dana', name: 'Dana Whitcomb', email: 'dana@flintlockrobotics.com', slack_id: 'U07FLK0DANA', team: 't-supply', title: 'Senior NPI Buyer', manager: null },
    { id: 'p-hana', name: 'Hana Sato', email: 'hana@flintlockrobotics.com', slack_id: 'U07FLK0HANA', team: 't-legs', title: 'Mech, legs', manager: null },
  ],
  teams: [
    { id: 't-actuators', name: 'Actuators', lead: 'p-arjun', members: ['p-arjun', 'p-owen'], channels: ['C07FLK0ACTU'], jira_project: 'HIP' },
    { id: 't-supply', name: 'Supply chain', lead: 'p-samir', members: ['p-samir', 'p-dana'], channels: ['C07FLK0SUPC'], jira_project: 'SCM' },
    { id: 't-legs', name: 'Legs', lead: 'p-hana', members: ['p-hana'], channels: ['C07FLK0LEGS'], jira_project: 'LEG' },
  ],
  assemblies: [
    { id: 'a-hip-actuator', name: 'Hip actuator', jira_project: 'HIP', slack_channel: 'C07FLK0ACTU', team: 't-actuators' },
    { id: 'a-knee-actuator', name: 'Knee actuator', jira_project: 'HIP', slack_channel: 'C07FLK0ACTU', team: 't-actuators' },
    { id: 'a-ankle', name: 'Ankle and foot', jira_project: 'LEG', slack_channel: 'C07FLK0LEGS', team: 't-legs' },
  ],
  parts: [
    { id: 'pt-hip-bracket', part_number: 'FL-HIP-1042', name: 'Hip actuator bracket', aliases: ['hip bracket', 'the bracket', '1042', 'motor bracket'], assembly: 'a-hip-actuator', kind: 'robot_part' },
    { id: 'pt-spin-coupling', part_number: 'FL-TST-2051', name: 'Spin-test shaft coupling', aliases: ['spin coupling', 'the coupling'], assembly: 'a-hip-actuator', kind: 'test_hardware' },
    { id: 'pt-knee-flange', part_number: 'FL-KNE-1120', name: 'Knee to thigh flange', aliases: ['knee flange', '1120'], assembly: 'a-knee-actuator', kind: 'robot_part' },
    { id: 'pt-ankle-bushing', part_number: 'FL-ANK-1290', name: 'Ankle pivot bushing', aliases: ['ankle bushing', '1290'], assembly: 'a-ankle', kind: 'robot_part' },
  ],
  deliverables: [
    { id: 'dl-hip-motor-dvt', name: 'DVT hip frameless motor', aliases: ['dvt motor', 'frameless motor'], owner: 'p-arjun', assembly: 'a-hip-actuator', kind: 'motor' },
    { id: 'dl-fw-actuator-v2', name: 'Actuator firmware v2', aliases: [], owner: 'p-arjun', assembly: 'a-hip-actuator', kind: 'firmware' },
  ],
  tests: [
    { id: 'test-hip-spin', name: 'Hip actuator DVT spin test', assembly: 'a-hip-actuator', rig: 'rig-spin-test-stand', resources: [], owner: 'p-arjun', milestone: 'm-hip-spin-test',
      duration_estimate_days: [2, 3], planned_date: [{ value: '2026-11-23', known_at: '2026-10-22T10:45:00-07:00', by: 'p-arjun' }] },
    { id: 'test-hip-dyno', name: 'Hip actuator dyno torque test', assembly: 'a-hip-actuator', rig: 'rig-actuator-dyno', resources: [], owner: 'p-arjun', milestone: 'm-actuator-dvt-build',
      duration_estimate_days: [3, 4], planned_date: [] },
  ],
  rigs: [
    { id: 'rig-spin-test-stand', name: 'Spin-test stand', slot_days: null, owner: 'p-andre' },
    { id: 'rig-actuator-dyno', name: 'Actuator dyno', slot_days: null, owner: 'p-andre' },
  ],
  milestones: [
    { id: 'm-hip-spin-test', name: 'Hip actuator DVT spin test complete', owner: 'p-arjun', hardness: 'soft', assemblies: ['a-hip-actuator'],
      date: [{ value: '2026-11-24', known_at: '2026-10-22T10:45:00-07:00', by: 'p-arjun' }], value_policy: [] },
    { id: 'm-actuator-dvt-build', name: 'Actuator DVT build', owner: 'p-arjun', hardness: 'soft', assemblies: ['a-hip-actuator', 'a-knee-actuator'],
      date: [{ value: '2026-10-01', known_at: '2026-09-16T14:25:00-07:00', by: 'p-arjun' }], value_policy: [] },
  ],
};

const arjun = { name: 'Arjun Venkatesan', email: 'arjun@flintlockrobotics.com', slack_id: 'U07FLK0ARJN' };
const owen = { name: 'Owen Halloran', email: 'owen@flintlockrobotics.com', slack_id: 'U07FLK0OWEN' };
const samir = { name: 'Samir Khoury', email: 'samir@flintlockrobotics.com', slack_id: 'U07FLK0SAMI' };
const dana = { name: 'Dana Whitcomb', email: 'dana@flintlockrobotics.com', slack_id: 'U07FLK0DANA' };
const slack = (ch, at, author, text, thread) => ({ id: `slack:${ch}:${Date.parse(at) / 1000}.000100`, source: 'slack', container: ch, thread: thread || `${Date.parse(at) / 1000}.000100`, author, at, text });

// Docs in the phrasing of the rendered crumbs and of the written example jobs (the world generator's example jobs).
export const docs = [
  slack('C07FLK0ACTU', '2026-10-01T11:18:00-07:00', arjun, 'DVT hip frameless motor eta 10/26'),
  slack('C07FLK0SUPC', '2026-10-14T15:02:33-07:00', samir, 'dvt motor eta fri the 13th, per cubemars'),
  slack('C07FLK0ACTU', '2026-10-20T09:41:40-07:00', arjun, 'DVT hip frameless motor blocked (the test)'),
  { id: 'meeting:2026-10-22-1030-supply-chain-mech-sync.md:14', source: 'meeting', container: '2026-10-22-1030-supply-chain-mech-sync.md', thread: '2026-10-22-1030-supply-chain-mech-sync.md',
    author: arjun, at: '2026-10-22T10:38:32-07:00', text: 'On the motor, I talked to the vendor yesterday. Realistic date is the twentieth. So spin test moves to the week of the twenty third.' },
  slack('C07FLK0ACTU', '2026-10-22T14:56:28-07:00', arjun, 'Hip actuator DVT spin test blocked (Hip actuator DVT spin test complete)'),
  slack('C07FLK0ACTU', '2026-10-26T11:39:11-07:00', arjun, 'Spin-test stand blocked (the test)'),
  slack('C07FLK0ACTU', '2026-11-02T10:01:52-08:00', arjun, 'Hip actuator bracket blocked (Hip actuator DVT spin test)'),
  slack('C07FLK0ACTU', '2026-11-07T10:12:00-08:00', arjun, 'dvt motor still on track for 11/20 per vendor. the spin test takes 3 days once both are in'),
  slack('C07FLK0LEGS', '2026-11-03T09:00:00-08:00', { name: 'Hana Sato', email: 'hana@flintlockrobotics.com', slack_id: 'U07FLK0HANA' }, 'need 64x 1290 by 11/20'),
  slack('C07FLK0ACTU', '2026-11-03T09:05:00-08:00', owen, 'need 25x FL-KNE-1120 by tues the 24th (Fit check: Knee to thigh flange)'),
  { id: 'jira:HIP-401:desc', source: 'jira', container: 'HIP-401', thread: 'HIP-401', author: owen, at: '2026-10-28T15:30:00-07:00', text: 'Order hip brackets rev C for spin test\nneed 4x FL-HIP-1042 by thurs (Hip actuator DVT spin test)' },
  { id: 'jira:HIP-401:h1:status', source: 'jira', container: 'HIP-401', thread: 'HIP-401', author: owen, at: '2026-10-28T15:31:00-07:00', text: 'status: To Do -> In Progress', field: 'status', from: 'To Do', to: 'In Progress' },
  { id: 'jira:HIP-402:desc', source: 'jira', container: 'HIP-402', thread: 'HIP-402', author: arjun, at: '2026-10-05T09:00:00-07:00', text: 'Spin coupling machining' },
  { id: 'jira:HIP-402:h1:status', source: 'jira', container: 'HIP-402', thread: 'HIP-402', author: arjun, at: '2026-10-20T09:00:00-07:00', text: 'status: In Progress -> Done', field: 'status', from: 'In Progress', to: 'Done' },
  { id: 'jira:HIP-403:desc', source: 'jira', container: 'HIP-403', thread: 'HIP-403', author: owen, at: '2026-10-06T09:00:00-07:00', text: 'Knee flange fit check' },
  { id: 'jira:LEG-10:desc', source: 'jira', container: 'LEG-10', thread: 'LEG-10', author: dana, at: '2026-10-06T09:00:00-07:00', text: 'Ankle bushing order' },
  { id: 'jira:LEG-10:h1:status', source: 'jira', container: 'LEG-10', thread: 'LEG-10', author: dana, at: '2026-10-08T09:00:00-07:00', text: 'status: To Do -> Done', field: 'status', from: 'To Do', to: 'Done' },
  { id: 'cal:bk-00001', source: 'calendar', container: 'calendar', thread: 'bk-00001', author: arjun, at: '2026-10-22T10:50:00-07:00',
    text: 'Spin-test stand: Hip actuator DVT spin test (Arjun) - tentative\nSpin-test stand booked by Arjun Venkatesan for Hip actuator DVT spin test.' },
].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.id < b.id ? -1 : 1));

export const calendar = [
  { uid: 'bk-00001', summary: 'Spin-test stand: Hip actuator DVT spin test (Arjun) - tentative', start: '2026-11-23T09:00:00-08:00', end: '2026-11-25T17:00:00-08:00', attendees: ['arjun@flintlockrobotics.com'], categories: ['BOOKING'] },
  { uid: 'bk-00008', summary: 'Actuator dyno: Hip actuator dyno torque test (Andre)', start: '2026-09-15T09:00:00-07:00', end: '2026-09-18T17:00:00-07:00', attendees: [], categories: ['BOOKING'] },
  { uid: 'cal-m-hip-spin-test', summary: 'Hip actuator DVT spin test complete', start: '2026-11-24', end: '2026-11-25', attendees: [], categories: ['MILESTONE'] },
];

export const demo = {
  partEntry: { part_name: 'Hip actuator bracket', part_number: 'FL-HIP-1042', revision: 'C', quantity: 4, requester: { name: 'Owen Halloran', email: 'owen@flintlockrobotics.com' }, entered_at: '2026-11-10T10:05:00-08:00' },
  quote: { quote_id: 'Q-2617750-1', parts: [{ part_number: 'FL-HIP-1042', quantity: 4 }], lead_time_options: [] },
  policy: { policies: [
    { milestone: 'Hip actuator DVT spin test complete', milestone_date: '2026-11-24', type: 'per_day', usd_per_day: 600, curve: null, set_by: { name: 'Arjun Venkatesan', email: 'arjun@flintlockrobotics.com' }, set_at: '2026-10-05T09:15:00-07:00' },
    { milestone: 'Actuator DVT build', milestone_date: '2026-10-01', type: 'per_day', usd_per_day: 450, curve: null, set_by: { name: 'Ingrid Solberg', email: 'ingrid@flintlockrobotics.com' }, set_at: '2026-02-10T09:00:00-08:00' },
  ] },
  // copied from fixtures/flintlock/demo/live-changes.json (pinned demo text)
  liveChanges: { changes: [
    { order: 1, label: 'Change 1', source: 'slack', offset_minutes: 15, message: { type: 'message', channel: 'C07FLK0ACTU', channel_name: 'actuators', user: 'U07FLK0ARJN', user_name: 'arjun', text: 'heads up, vendor slipped the dvt hip frameless motor again. new ETA 11/30' } },
    { order: 2, label: 'Change 2', source: 'slack', offset_minutes: 15, message: { type: 'message', channel: 'C07FLK0ACTU', channel_name: 'actuators', user: 'U07FLK0ARJN', user_name: 'arjun', text: "dvt hip frameless motor: vendor won't commit to a date. somewhere between 11/19 and 11/30" } },
  ] },
};

export const sources = {
  docs, calendar, demo,
  xometry: { quotes: [], orders: [{ order_number: 'XO-5545802', quote_id: 'Q-2600000-1', placed_at: '2026-10-14T10:00:00-07:00', lead_time: 'Standard', line_items: [{ part_number: 'FL-TST-2051', quantity: 2 }], promised_delivery_date: '2026-10-28', status: 'Delivered', status_history: [] }] },
  ramp: { transactions: [], bills: [] },
};
