// QR encoder round-trip + structure (DSG-S3). The encoder follows the QR spec
// (RS ECC, masking, format/version info); decodeQr inverts the placement+mask+
// interleave so we can verify the key data survives end to end. `node --test`.

import test from "node:test";
import assert from "node:assert/strict";

import { encodeQr, decodeQr, qrSvg } from "../src/qr.mjs";

const SAMPLES = [
  "hi",
  "pk_demo_0001",
  "BASE64+key/with=padding-and_symbols.0123456789",
  "ml-kem-768:" + "A".repeat(180), // a key-sized payload (forces a higher version)
  "café, résumé ✦", // multibyte UTF-8
];

test("encode → decode round-trips the payload", () => {
  for (const s of SAMPLES) {
    const qr = encodeQr(s);
    assert.equal(decodeQr(qr), s, `round-trip failed for ${JSON.stringify(s.slice(0, 20))}`);
  }
});

test("matrix is square with the version's size and a quiet-zone-free grid", () => {
  const qr = encodeQr("pk_demo_0001");
  assert.equal(qr.size, qr.version * 4 + 17);
  assert.equal(qr.modules.length, qr.size);
  assert.ok(qr.modules.every((row) => row.length === qr.size));
});

test("finder patterns sit in the three corners", () => {
  const qr = encodeQr("hello world");
  const n = qr.size;
  // Finder centres are dark; the ring at distance 2 is light.
  for (const [cx, cy] of [
    [3, 3],
    [n - 4, 3],
    [3, n - 4],
  ]) {
    assert.equal(qr.modules[cy][cx], true, "finder centre dark");
    assert.equal(qr.modules[cy][cx + 2], false, "finder ring light");
  }
});

test("encoding is deterministic", () => {
  assert.deepEqual(encodeQr("steady").modules, encodeQr("steady").modules);
});

test("qrSvg renders dark-on-light SVG with a quiet zone", () => {
  const svg = qrSvg("pk_demo_0001", { size: 200 });
  assert.match(svg, /<svg/);
  assert.match(svg, /<rect[^>]*fill="#FFFFFF"/);
  assert.match(svg, /<path[^>]*fill="#11100E"/);
  const qr = encodeQr("pk_demo_0001");
  assert.match(svg, new RegExp(`viewBox="0 0 ${qr.size + 8} ${qr.size + 8}"`));
});

test("larger payloads pick a higher version and still round-trip", () => {
  const big = "x".repeat(600);
  const qr = encodeQr(big);
  assert.ok(qr.version >= 10, `expected a higher version, got ${qr.version}`);
  assert.equal(decodeQr(qr), big);
});
