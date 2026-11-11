// Headless Xometry provider: Playwright on Burn's server, logged into a company Teamspace
// account. This is the production shape; the browser steps are not implemented until
// open questions X1 (terms), X5 (account) and X6 (bot detection) are resolved, so every
// method reports its capability honestly instead of pretending.
//
// When implemented: quote() uploads the CAD through the hidden file input, sets each
// field, reads back every tier, price and expiry; place() reopens the Teamspace quote,
// reads back every field, compares with the frozen spec, enters the card from the
// server-side vault, clicks Place order, reads the confirmation. Plain Playwright for
// every exact step; the model never drives the final click.

const NOT_READY = 'headless Xometry provider not enabled: resolve X1/X5/X6 and set XOMETRY_* credentials';

export function createHeadlessVendor({credentials = {user: process.env.XOMETRY_USER, password: process.env.XOMETRY_PASSWORD}} = {}) {
  const enabled = !!(credentials.user && credentials.password && process.env.XOMETRY_HEADLESS_ENABLED === '1');
  return {
    describe: () => ({vendor: 'xometry', mode: 'headless', capabilities: {quote: enabled, place: enabled, status: enabled, teamspaceReuse: enabled}}),
    async quote() { throw new Error(NOT_READY); },
    async place() { return {outcome: 'failed', reason: NOT_READY}; },
    async status() { return {status: 'unknown', promisedOn: null, tracking: null}; },
    async findOrder() { return {found: false}; },
  };
}
