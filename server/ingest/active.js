// The running server's ingest, so agent tools can read the same documents and graph the
// /graph page shows. Unset in unit tests and offline runs: tools then use their fixtures.
let active = null;
export const setActiveIngest = ingest => { active = ingest; };
export const activeIngest = () => active;
