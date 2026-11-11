// VendorProvider factory (see server/contracts.js). One interface, swappable backends:
//   fake      in-process fake Xometry (default; the demo never touches xometry.com)
//   headless  Playwright against xometry.com on a company account (stub until X1/X5/X6 are answered)
import {createFakeVendor} from './fake.js';
import {createHeadlessVendor} from './headless.js';

export function createVendorProvider({mode = process.env.VENDOR_MODE || 'fake', ...options} = {}) {
  if (mode === 'fake') return createFakeVendor(options);
  if (mode === 'headless') return createHeadlessVendor(options);
  throw new Error(`Unknown VENDOR_MODE: ${mode}`);
}
