// Runs the simulated Xometry site on its own port (XOMETRY_SIM_PORT, default 5175), which is
// where the headless provider points by default (XOMETRY_BASE_URL). The same site is also
// mounted under the main app at /xometry-sim for convenience.
import {createXometrySite} from './index.js';

const site = createXometrySite();
const {port} = await site.listen();
console.log(`Xometry (simulated): http://127.0.0.1:${port}/  (records in ${process.env.XOMETRY_SIM_DB || 'data/xometry-sim.sqlite'})`);
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => site.close().then(() => process.exit(0)));
