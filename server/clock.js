// The server clock. Real time by default; BURN_NOW=<ISO> anchors the clock at that instant
// when the process starts and lets it run from there, so a demo set on a given day behaves the
// same whenever it is run (vendor cutoffs, quote validity, "today" in the schedule). Every
// time-dependent component takes a `now` so tests can pin it; this is the one default they share.
export function createClock({start = process.env.BURN_NOW || null, real = Date.now} = {}) {
  const anchor = start ? Date.parse(start) : null;
  if (start && !Number.isFinite(anchor)) throw new Error(`BURN_NOW is not a date: ${start}`);
  const offset = anchor == null ? 0 : anchor - real();
  const ms = () => real() + offset;
  return {ms, date: () => new Date(ms()), iso: () => new Date(ms()).toISOString(), today: () => new Date(ms()).toISOString().slice(0, 10), anchored: anchor != null};
}
export const clock = createClock();
