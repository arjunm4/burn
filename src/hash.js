// Stable content hash that works in Node and the browser without async crypto.
// FNV-1a over UTF-16 code units, widened to 64 bits as two 32-bit lanes. It identifies
// snapshots and decisions (so a card can say "built from snapshot 3f9a…"); it is not a
// security primitive. OrderSpec hashes use sha256 in server/contracts.js.
export function createHash(text) {
  let h1 = 0x811c9dc5, h2 = 0xcbf29ce4;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ (c + i), 0x01000193) >>> 0;
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}
