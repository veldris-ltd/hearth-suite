/**
 * A tiny, dependency-free ZIP writer/reader using the STORED (no-compression)
 * method.
 *
 * `.docx` and `.odt` are both ZIP archives of XML parts, so this is all the
 * packaging they need. STORED keeps the codec trivial and — importantly for
 * `.odt` — lets the `mimetype` member be stored uncompressed as the first
 * entry, which the OpenDocument spec requires. Written from scratch because the
 * repo carries no zip/deflate utility and the parts are tiny (a few KB of XML).
 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

/** CRC-32 (IEEE 802.3, poly 0xEDB88320) of a byte array. */
export function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** Encode text as UTF-8 bytes. */
export function utf8(text) {
  return new TextEncoder().encode(text);
}

// A fixed, valid DOS timestamp (1980-01-01 00:00) so archives are reproducible
// and tools don't flag a zero date.
const DOS_TIME = 0;
const DOS_DATE = 0x21;

/** A growable little-endian byte buffer. */
class ByteWriter {
  #parts = [];
  #len = 0;

  get length() {
    return this.#len;
  }

  u16(value) {
    this.#push(new Uint8Array([value & 0xff, (value >>> 8) & 0xff]));
  }

  u32(value) {
    this.#push(
      new Uint8Array([
        value & 0xff,
        (value >>> 8) & 0xff,
        (value >>> 16) & 0xff,
        (value >>> 24) & 0xff,
      ]),
    );
  }

  bytes(data) {
    this.#push(data);
  }

  #push(chunk) {
    this.#parts.push(chunk);
    this.#len += chunk.length;
  }

  concat() {
    const out = new Uint8Array(this.#len);
    let at = 0;
    for (const part of this.#parts) {
      out.set(part, at);
      at += part.length;
    }
    return out;
  }
}

/**
 * Pack `entries` (each `{ name, data }`) into a ZIP archive (STORED). Entries
 * are written in the order given — put `.odt`'s `mimetype` first.
 */
export function zipStore(entries) {
  const out = new ByteWriter();
  const central = [];

  for (const entry of entries) {
    const name = utf8(entry.name);
    const crc = crc32(entry.data);
    const offset = out.length;
    out.u32(0x04034b50); // local file header signature
    out.u16(20); // version needed
    out.u16(0); // flags
    out.u16(0); // method: STORED
    out.u16(DOS_TIME);
    out.u16(DOS_DATE);
    out.u32(crc);
    out.u32(entry.data.length); // compressed size
    out.u32(entry.data.length); // uncompressed size
    out.u16(name.length);
    out.u16(0); // extra length
    out.bytes(name);
    out.bytes(entry.data);
    central.push({ name, crc, size: entry.data.length, offset });
  }

  const cdStart = out.length;
  for (const item of central) {
    out.u32(0x02014b50); // central directory header signature
    out.u16(20); // version made by
    out.u16(20); // version needed
    out.u16(0); // flags
    out.u16(0); // method
    out.u16(DOS_TIME);
    out.u16(DOS_DATE);
    out.u32(item.crc);
    out.u32(item.size);
    out.u32(item.size);
    out.u16(item.name.length);
    out.u16(0); // extra
    out.u16(0); // comment
    out.u16(0); // disk number start
    out.u16(0); // internal attrs
    out.u32(0); // external attrs
    out.u32(item.offset);
    out.bytes(item.name);
  }
  const cdSize = out.length - cdStart;

  out.u32(0x06054b50); // end of central directory signature
  out.u16(0); // disk number
  out.u16(0); // disk with central dir
  out.u16(central.length);
  out.u16(central.length);
  out.u32(cdSize);
  out.u32(cdStart);
  out.u16(0); // comment length
  return out.concat();
}

/**
 * Read a STORED ZIP archive back to `{ name, data, crc, crcOk }[]` by scanning
 * local file headers. Decode-only and STORED-only — enough to validate what
 * `zipStore` produced (used by tests). Throws on a bad local-header signature.
 */
export function unzipStore(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder();
  const out = [];
  let at = 0;
  while (at + 4 <= bytes.length && view.getUint32(at, true) === 0x04034b50) {
    const crc = view.getUint32(at + 14, true);
    const size = view.getUint32(at + 18, true);
    const nameLen = view.getUint16(at + 26, true);
    const extraLen = view.getUint16(at + 28, true);
    const nameStart = at + 30;
    const dataStart = nameStart + nameLen + extraLen;
    const name = decoder.decode(bytes.subarray(nameStart, nameStart + nameLen));
    const data = bytes.subarray(dataStart, dataStart + size);
    out.push({ name, data, crc, crcOk: crc32(data) === crc });
    at = dataStart + size;
  }
  return out;
}
