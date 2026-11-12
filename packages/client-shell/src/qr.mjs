/**
 * A local, no-network QR encoder (DSG-S3), byte mode, ECC level M, versions
 * 1–40. Used for Seal key exchange so a key can travel by camera, never over a
 * network. Implements the QR spec (GF(256) Reed–Solomon, alignment patterns,
 * data masking, format/version info) so the output is scannable; `decodeQr`
 * inverts the pipeline for a genuine round-trip test. Types: see qr.d.mts.
 *
 * Algorithm follows Nayuki's reference QR generator (MIT).
 */

// ECC level M tables, indexed by version (1..40); index 0 is unused.
const ECC_CW_PER_BLOCK_M = [
  -1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28,
  28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28,
];
const NUM_BLOCKS_M = [
  -1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25,
  26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49,
];

// ---- Galois field GF(256) with primitive polynomial 0x11D -----------------
const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i += 1) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i += 1) GF_EXP[i] = GF_EXP[i - 255];
})();
function gfMul(a, b) {
  return a === 0 || b === 0 ? 0 : GF_EXP[GF_LOG[a] + GF_LOG[b]];
}
function rsGenerator(degree) {
  let poly = [1];
  for (let i = 0; i < degree; i += 1) {
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j += 1) {
      next[j] ^= gfMul(poly[j], GF_EXP[i]);
      next[j + 1] ^= poly[j];
    }
    poly = next;
  }
  return poly;
}
function rsRemainder(data, gen) {
  const res = new Array(gen.length - 1).fill(0);
  for (const b of data) {
    const factor = b ^ res[0];
    res.shift();
    res.push(0);
    for (let i = 0; i < res.length; i += 1) res[i] ^= gfMul(gen[i], factor);
  }
  return res;
}

// ---- Capacity helpers -----------------------------------------------------
function numRawDataModules(ver) {
  let result = (16 * ver + 128) * ver + 64;
  if (ver >= 2) {
    const numAlign = Math.floor(ver / 7) + 2;
    result -= (25 * numAlign - 10) * numAlign - 55;
    if (ver >= 7) result -= 36;
  }
  return result;
}
function numDataCodewords(ver) {
  const total = Math.floor(numRawDataModules(ver) / 8);
  return total - ECC_CW_PER_BLOCK_M[ver] * NUM_BLOCKS_M[ver];
}
function charCountBits(ver) {
  return ver <= 9 ? 8 : 16;
}
function chooseVersion(byteLen) {
  for (let ver = 1; ver <= 40; ver += 1) {
    if (4 + charCountBits(ver) + 8 * byteLen <= numDataCodewords(ver) * 8) return ver;
  }
  throw new Error("Data too long for a QR code");
}

function toUtf8(text) {
  return Array.from(new TextEncoder().encode(text));
}

function dataCodewords(bytes, ver) {
  const bits = [];
  const push = (val, len) => {
    for (let i = len - 1; i >= 0; i -= 1) bits.push((val >> i) & 1);
  };
  push(0b0100, 4); // byte mode
  push(bytes.length, charCountBits(ver));
  for (const b of bytes) push(b, 8);
  const capacity = numDataCodewords(ver) * 8;
  push(0, Math.min(4, capacity - bits.length)); // terminator
  while (bits.length % 8 !== 0) bits.push(0);
  const words = [];
  for (let i = 0; i < bits.length; i += 8) {
    let w = 0;
    for (let j = 0; j < 8; j += 1) w = (w << 1) | bits[i + j];
    words.push(w);
  }
  for (let pad = 0xec; words.length < numDataCodewords(ver); pad ^= 0xec ^ 0x11) words.push(pad);
  return words;
}

function buildBlocks(data, ver) {
  const numBlocks = NUM_BLOCKS_M[ver];
  const eccLen = ECC_CW_PER_BLOCK_M[ver];
  const totalCw = Math.floor(numRawDataModules(ver) / 8);
  const numShort = numBlocks - (totalCw % numBlocks);
  const shortDataLen = Math.floor(totalCw / numBlocks) - eccLen;
  const gen = rsGenerator(eccLen);
  const blocks = [];
  let off = 0;
  for (let i = 0; i < numBlocks; i += 1) {
    const len = shortDataLen + (i < numShort ? 0 : 1);
    const d = data.slice(off, off + len);
    off += len;
    blocks.push({ data: d, ecc: rsRemainder(d, gen) });
  }
  return blocks;
}
function interleave(blocks) {
  const out = [];
  const maxData = Math.max(...blocks.map((b) => b.data.length));
  for (let i = 0; i < maxData; i += 1)
    for (const b of blocks) if (i < b.data.length) out.push(b.data[i]);
  const eccLen = blocks[0].ecc.length;
  for (let i = 0; i < eccLen; i += 1) for (const b of blocks) out.push(b.ecc[i]);
  return out;
}

function alignmentPositions(ver) {
  if (ver === 1) return [];
  const numAlign = Math.floor(ver / 7) + 2;
  const size = ver * 4 + 17;
  const step = ver === 32 ? 26 : Math.ceil((size - 13) / (numAlign * 2 - 2)) * 2;
  const pos = [6];
  for (let p = size - 7; pos.length < numAlign; p -= step) pos.splice(1, 0, p);
  return pos;
}

function maskBit(mask, x, y) {
  switch (mask) {
    case 0:
      return (x + y) % 2 === 0;
    case 1:
      return y % 2 === 0;
    case 2:
      return x % 3 === 0;
    case 3:
      return (x + y) % 3 === 0;
    case 4:
      return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
    case 5:
      return ((x * y) % 2) + ((x * y) % 3) === 0;
    case 6:
      return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
    default:
      return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
  }
}

class Matrix {
  constructor(ver) {
    this.ver = ver;
    this.size = ver * 4 + 17;
    this.modules = Array.from({ length: this.size }, () => new Array(this.size).fill(false));
    this.isFn = Array.from({ length: this.size }, () => new Array(this.size).fill(false));
  }
  set(x, y, dark) {
    this.modules[y][x] = dark;
    this.isFn[y][x] = true;
  }
  drawFunctionPatterns() {
    const n = this.size;
    for (let i = 0; i < n; i += 1) {
      this.set(6, i, i % 2 === 0);
      this.set(i, 6, i % 2 === 0);
    }
    this.finder(3, 3);
    this.finder(n - 4, 3);
    this.finder(3, n - 4);
    const align = alignmentPositions(this.ver);
    for (const ay of align)
      for (const ax of align) {
        if ((ax === 6 && ay === 6) || (ax === 6 && ay === n - 7) || (ax === n - 7 && ay === 6))
          continue;
        this.alignment(ax, ay);
      }
    for (let i = 0; i < 9; i += 1) {
      this.set(8, i, false);
      this.set(i, 8, false);
      this.set(8, n - 1 - i, false);
      this.set(n - 1 - i, 8, false);
    }
    this.set(8, n - 8, true);
    if (this.ver >= 7) {
      for (let i = 0; i < 18; i += 1) {
        this.set((i % 3) + n - 11, Math.floor(i / 3), false);
        this.set(Math.floor(i / 3), (i % 3) + n - 11, false);
      }
    }
  }
  finder(cx, cy) {
    for (let dy = -4; dy <= 4; dy += 1)
      for (let dx = -4; dx <= 4; dx += 1) {
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || x >= this.size || y < 0 || y >= this.size) continue;
        const d = Math.max(Math.abs(dx), Math.abs(dy));
        this.set(x, y, d !== 2 && d !== 4);
      }
  }
  alignment(cx, cy) {
    for (let dy = -2; dy <= 2; dy += 1)
      for (let dx = -2; dx <= 2; dx += 1)
        this.set(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }
  walk(cb) {
    const n = this.size;
    for (let right = n - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let v = 0; v < n; v += 1) {
        for (let j = 0; j < 2; j += 1) {
          const x = right - j;
          const upward = ((right + 1) & 2) === 0;
          const y = upward ? n - 1 - v : v;
          if (!this.isFn[y][x]) cb(x, y);
        }
      }
    }
  }
  drawCodewords(words) {
    let i = 0;
    this.walk((x, y) => {
      if (i < words.length * 8) {
        this.modules[y][x] = ((words[i >> 3] >> (7 - (i & 7))) & 1) !== 0;
        i += 1;
      }
    });
  }
  applyMask(mask) {
    for (let y = 0; y < this.size; y += 1)
      for (let x = 0; x < this.size; x += 1)
        if (!this.isFn[y][x] && maskBit(mask, x, y)) this.modules[y][x] = !this.modules[y][x];
  }
  drawFormat(mask) {
    const n = this.size;
    const data = (0b00 << 3) | mask; // ECC level M = 0b00
    let rem = data;
    for (let i = 0; i < 10; i += 1) rem = (rem << 1) ^ ((rem >> 9) * 0x537);
    const bits = ((data << 10) | rem) ^ 0x5412;
    const get = (i) => ((bits >> i) & 1) !== 0;
    for (let i = 0; i <= 5; i += 1) this.set(8, i, get(i));
    this.set(8, 7, get(6));
    this.set(8, 8, get(7));
    this.set(7, 8, get(8));
    for (let i = 9; i < 15; i += 1) this.set(14 - i, 8, get(i));
    for (let i = 0; i < 8; i += 1) this.set(n - 1 - i, 8, get(i));
    for (let i = 8; i < 15; i += 1) this.set(8, n - 15 + i, get(i));
    this.set(8, n - 8, true);
  }
  drawVersion() {
    if (this.ver < 7) return;
    let rem = this.ver;
    for (let i = 0; i < 12; i += 1) rem = (rem << 1) ^ ((rem >> 11) * 0x1f25);
    const bits = (this.ver << 12) | rem;
    const n = this.size;
    for (let i = 0; i < 18; i += 1) {
      const bit = ((bits >> i) & 1) !== 0;
      this.set((i % 3) + n - 11, Math.floor(i / 3), bit);
      this.set(Math.floor(i / 3), (i % 3) + n - 11, bit);
    }
  }
  penalty() {
    const n = this.size;
    const m = this.modules;
    let p = 0;
    for (let y = 0; y < n - 1; y += 1)
      for (let x = 0; x < n - 1; x += 1)
        if (m[y][x] === m[y][x + 1] && m[y][x] === m[y + 1][x] && m[y][x] === m[y + 1][x + 1])
          p += 3;
    let dark = 0;
    for (let y = 0; y < n; y += 1) for (let x = 0; x < n; x += 1) if (m[y][x]) dark += 1;
    p += Math.floor(Math.abs((dark * 100) / (n * n) - 50) / 5) * 10;
    return p;
  }
}

/** Encode text into a QR code (byte mode, ECC level M). */
export function encodeQr(text) {
  const bytes = toUtf8(text);
  const ver = chooseVersion(bytes.length);
  const codewords = interleave(buildBlocks(dataCodewords(bytes, ver), ver));
  let best = null;
  let bestPenalty = Infinity;
  let bestMask = 0;
  for (let mask = 0; mask < 8; mask += 1) {
    const m = new Matrix(ver);
    m.drawFunctionPatterns();
    m.drawCodewords(codewords);
    m.drawVersion();
    m.applyMask(mask);
    m.drawFormat(mask);
    const pen = m.penalty();
    if (pen < bestPenalty) {
      bestPenalty = pen;
      best = m;
      bestMask = mask;
    }
  }
  return { size: best.size, modules: best.modules, version: ver, mask: bestMask };
}

/** Decode the data text back out of a QrCode (level M, byte mode), for tests. */
export function decodeQr(qr) {
  const m = new Matrix(qr.version);
  m.drawFunctionPatterns();
  for (let y = 0; y < qr.size; y += 1)
    for (let x = 0; x < qr.size; x += 1) m.modules[y][x] = qr.modules[y][x];
  for (let y = 0; y < qr.size; y += 1)
    for (let x = 0; x < qr.size; x += 1)
      if (!m.isFn[y][x] && maskBit(qr.mask, x, y)) m.modules[y][x] = !m.modules[y][x];

  const bits = [];
  m.walk((x, y) => bits.push(m.modules[y][x] ? 1 : 0));
  const stream = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    let w = 0;
    for (let j = 0; j < 8; j += 1) w = (w << 1) | bits[i + j];
    stream.push(w);
  }

  const ver = qr.version;
  const numBlocks = NUM_BLOCKS_M[ver];
  const eccLen = ECC_CW_PER_BLOCK_M[ver];
  const totalCw = Math.floor(numRawDataModules(ver) / 8);
  const numShort = numBlocks - (totalCw % numBlocks);
  const shortDataLen = Math.floor(totalCw / numBlocks) - eccLen;
  const blockData = Array.from({ length: numBlocks }, () => []);
  const maxData = shortDataLen + 1;
  let idx = 0;
  for (let i = 0; i < maxData; i += 1)
    for (let b = 0; b < numBlocks; b += 1) {
      const len = shortDataLen + (b < numShort ? 0 : 1);
      if (i < len) blockData[b].push(stream[idx++]);
    }
  const data = [];
  for (const b of blockData) data.push(...b);

  const bitArr = [];
  for (const w of data) for (let i = 7; i >= 0; i -= 1) bitArr.push((w >> i) & 1);
  let pos = 0;
  const read = (len) => {
    let v = 0;
    for (let i = 0; i < len; i += 1) v = (v << 1) | bitArr[pos++];
    return v;
  };
  read(4); // mode
  const count = read(charCountBits(ver));
  const out = [];
  for (let i = 0; i < count; i += 1) out.push(read(8));
  return new TextDecoder().decode(new Uint8Array(out));
}

/**
 * Render a QR code as a scannable SVG string. Always dark-on-light (with a quiet
 * zone) for reliable scanning, regardless of the surrounding theme.
 */
export function qrSvg(text, opts = {}) {
  const qr = encodeQr(text);
  const border = 4;
  const dim = qr.size + border * 2;
  const px = opts.size ?? 220;
  const dark = opts.dark ?? "#11100E";
  const light = opts.light ?? "#FFFFFF";
  let path = "";
  for (let y = 0; y < qr.size; y += 1)
    for (let x = 0; x < qr.size; x += 1)
      if (qr.modules[y][x]) path += `M${x + border} ${y + border}h1v1h-1z`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${dim} ${dim}" width="${px}" height="${px}" ` +
    `shape-rendering="crispEdges" role="img" aria-label="QR code">` +
    `<rect width="${dim}" height="${dim}" fill="${light}"/><path d="${path}" fill="${dark}"/></svg>`
  );
}
