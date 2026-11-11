// VendorProvider factory (see server/contracts.js). One interface, swappable backends:
//   fake      in-process fake Xometry (default; the demo never touches xometry.com)
//   headless  Playwright (installed Chrome) against a Xometry-shaped site: the simulated one by default
//             (XOMETRY_BASE_URL), xometry.com once X1/X5/X6 are answered. Needs XOMETRY_HEADLESS_ENABLED=1.
import {createFakeVendor} from './fake.js';
import {createHeadlessVendor} from './headless.js';

export function createVendorProvider({mode = process.env.VENDOR_MODE || 'fake', ...options} = {}) {
  if (mode === 'fake') return createFakeVendor(options);
  if (mode === 'headless') return createHeadlessVendor(options);
  throw new Error(`Unknown VENDOR_MODE: ${mode}`);
}
