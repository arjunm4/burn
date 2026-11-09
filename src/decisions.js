export const COST = 1100;
export const decisions = [
      { id: 'sens', pr: 'PR-2291', part: 'ACS37002 sensors × 40', project: 'Rev C power board', who: 'Dana Okafor', asked: 2, blocked: 4, milestone: 'EVT build · Nov 14', slack: 0, chain: ["Firmware validation","Thermal & EMC"], chain0: "Lee, Marco", chain1: "Anya, Sam",
        tiers: [{ name: 'Standard', price: 300, days: 12 }, { name: 'Priority', price: 650, days: 7 }, { name: 'Expedited', price: 1200, days: 5 }],
        basis: 'Dana confirmed Rev B can’t substitute', link: '#rev-c-bringup · Oct 28', unknown: null },
      { id: 'harn', pr: 'PR-2294', part: 'Cable harness × 12', project: 'Rev C power board', who: 'Theo Marsh', asked: 0, blocked: 2, milestone: 'EVT build · Nov 14', slack: 0, chain: ["Board assembly"], chain0: "Dana, Theo", chain1: "",
        tiers: [{ name: 'Current vendor', price: 1100, days: 9 }, { name: 'Second vendor', price: 2400, days: 5 }],
        basis: 'Current vendor has no expedite', link: 'Vendor email · Nov 3', unknown: 'Second vendor lead time · 1 prior order' },
      { id: 'fpga', pr: 'PR-2301', part: 'FPGA dev kit × 2', project: 'Motor-control firmware', who: 'Marco Ruiz', asked: 2, blocked: 0, milestone: 'Firmware freeze · Dec 2', slack: 20, chain: ["Motor-control FW"], chain0: "Marco · OOO", chain1: "",
        tiers: [{ name: 'Standard', price: 0, days: 5 }, { name: 'Priority', price: 180, days: 3 }, { name: 'Expedited', price: 400, days: 1 }],
        basis: 'Only user is out until Nov 12', link: 'Calendar · Marco OOO', unknown: null },
      { id: 'cham', pr: 'PR-2302', part: 'Thermal chamber · 1 wk', project: 'Rev C power board', who: 'Anya Petrov', asked: 0, blocked: 2, milestone: 'EVT build · Nov 14', slack: 5, dep: 'sens', chain: ["Thermal & EMC"], chain0: "Anya, Sam", chain1: "",
        tiers: [{ name: 'Week of Nov 10', price: 1800, days: 5 }, { name: 'Week of Nov 17', price: 1800, days: 12 }],
        basis: 'Right week depends on EVT date', link: 'PR-2291', unknown: null },
      { id: 'mold', pr: 'PR-2288', part: 'Mold T1 sample run', project: 'Enclosure tooling', who: 'Sam Oyelaran', asked: 1, blocked: 3, milestone: 'DVT kickoff · Nov 24', slack: 9, chain: ["Fit check"], chain0: "Sam, Ines", chain1: "",
        tiers: [{ name: 'Standard', price: 0, days: 10 }, { name: 'Priority', price: 550, days: 6 }],
        basis: 'Standard lands 6 days early', link: 'Hardware calendar', unknown: null },
      { id: 'load', pr: 'PR-2297', part: 'Load cells × 4', project: 'Calibration rig', who: 'Ines Okafor', asked: 0, blocked: 0, milestone: 'Rig start · after EVT', slack: 14, chain: ["Calibration fixture"], chain0: "", chain1: "",
        tiers: [{ name: 'Standard', price: 0, days: 6 }],
        basis: 'Rig needs 2 EVT units first', link: 'Project plan', unknown: null },
      { id: 'probe', pr: 'PR-2305', part: 'Scope probes × 3', project: 'Motor-control firmware', who: 'Lee Tan', asked: 0, blocked: 0, milestone: 'None', slack: 30, chain: [], chain0: "", chain1: "",
        tiers: [{ name: 'Standard', price: 0, days: 4 }],
        basis: 'Bench stock', link: 'Spend history', unknown: null },
    ];
export function deriveDecisions(raw = decisions, approved = {}, limit = 500) { return raw.map(d => { const fastest = Math.min(...d.tiers.map(t => t.days));
      const tiers = d.tiers.map((t, i) => { const late = Math.max(0, t.days - fastest - d.slack); const delay = late * d.blocked * COST; return { ...t, i, late, delay, total: t.price + delay }; });
      const rec = tiers.reduce((a, b) => (b.total < a.total ? b : a));
      const cheapest = tiers.reduce((a, b) => (b.price < a.price ? b : a));
      const premium = rec.price - cheapest.price, avoided = cheapest.delay - rec.delay;
      const done = !!approved[d.id];
      const waitingOn = d.dep && !approved[d.dep] ? raw.find(x => x.id === d.dep) : null;
      const kind = done ? 'done' : waitingOn ? 'wait' : premium > limit || tiers[d.asked].i !== rec.i ? 'need' : 'auto';
      return { ...d, tiers, rec, cheapest, premium, avoided, done, waitingOn, kind }; }); }
