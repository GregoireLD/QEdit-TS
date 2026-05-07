/**
 * Minimal ZIP builder + reader (STORED method — files are not compressed inside the ZIP).
 * Produces/reads valid ZIP archives compatible with all standard tools.
 */

// ─── CRC-32 ────────────────────────────────────────────────────────────────

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(data: Uint8Array): number {
  let crc = 0xFFFFFFFF;
  for (const b of data) crc = (CRC_TABLE[(crc ^ b) & 0xFF] ^ (crc >>> 8)) >>> 0;
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

// ─── Little-endian helpers ─────────────────────────────────────────────────

function u16(buf: Uint8Array, off: number, v: number): void {
  buf[off]     =  v        & 0xff;
  buf[off + 1] = (v >>  8) & 0xff;
}

function u32(buf: Uint8Array, off: number, v: number): void {
  buf[off]     =  v         & 0xff;
  buf[off + 1] = (v >>>  8) & 0xff;
  buf[off + 2] = (v >>> 16) & 0xff;
  buf[off + 3] = (v >>> 24) & 0xff;
}

// ─── Reader ────────────────────────────────────────────────────────────────

const ZIP_LOCAL_SIG    = 0x04034b50;
const ZIP_CENTRAL_SIG  = 0x02014b50;

/**
 * Read a ZIP archive and return a map of filename → raw file data.
 * Only STORED (uncompressed) entries are supported; throws on any
 * entry that uses a compression method other than 0.
 * Directory entries (names ending with '/') are silently skipped.
 */
export function readZip(data: Uint8Array): Map<string, Uint8Array> {
  const view   = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const dec    = new TextDecoder('utf-8');
  const result = new Map<string, Uint8Array>();

  let pos = 0;
  while (pos + 30 <= data.length) {
    const sig = view.getUint32(pos, true);
    if (sig !== ZIP_LOCAL_SIG) break; // central directory or EOF

    const compression    = view.getUint16(pos +  8, true);
    const compressedSize = view.getUint32(pos + 18, true);
    const fileNameLen    = view.getUint16(pos + 26, true);
    const extraLen       = view.getUint16(pos + 28, true);
    const nameStart      = pos + 30;
    const dataStart      = nameStart + fileNameLen + extraLen;
    const name           = dec.decode(data.slice(nameStart, nameStart + fileNameLen));

    if (compression !== 0) {
      throw new Error(`ZIP entry "${name}" uses compression method ${compression} — only STORED (0) is supported`);
    }

    if (!name.endsWith('/')) {
      result.set(name, data.slice(dataStart, dataStart + compressedSize));
    }

    pos = dataStart + compressedSize;
  }

  return result;
}

// ─── Writer ────────────────────────────────────────────────────────────────

/** True if the first four bytes are the ZIP local-file-header signature. */
export function isZipMagic(data: Uint8Array): boolean {
  if (data.length < 4) return false;
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return v.getUint32(0, true) === ZIP_LOCAL_SIG || v.getUint32(0, true) === ZIP_CENTRAL_SIG;
}

// ─── Public ────────────────────────────────────────────────────────────────

/**
 * Build a ZIP archive from a map of filename → file data.
 * Files are stored uncompressed (STORED method, compression = 0).
 */
export function buildZip(files: Map<string, Uint8Array>): Uint8Array {
  const enc = new TextEncoder();

  interface Entry {
    nameBytes: Uint8Array;
    data:      Uint8Array;
    crc:       number;
    localOff:  number;
  }

  const entries: Entry[] = [];
  const localParts: Uint8Array[] = [];
  let localOffset = 0;

  // ── Local file headers + data ──────────────────────────────────────────
  for (const [name, data] of files) {
    const nameBytes = enc.encode(name);
    const crc       = crc32(data);

    // Local file header: 30 bytes + filename (no extra field)
    const lh = new Uint8Array(30 + nameBytes.length);
    u32(lh,  0, 0x04034b50);        // signature  PK\3\4
    u16(lh,  4, 20);                 // version needed: 2.0
    u16(lh,  6, 0);                  // general purpose flags
    u16(lh,  8, 0);                  // compression: STORED
    u16(lh, 10, 0);                  // last mod time
    u16(lh, 12, 0);                  // last mod date
    u32(lh, 14, crc);                // CRC-32
    u32(lh, 18, data.length);        // compressed size   (= uncompressed for STORED)
    u32(lh, 22, data.length);        // uncompressed size
    u16(lh, 26, nameBytes.length);   // filename length
    u16(lh, 28, 0);                  // extra field length
    lh.set(nameBytes, 30);

    entries.push({ nameBytes, data, crc, localOff: localOffset });
    localParts.push(lh, data);
    localOffset += lh.length + data.length;
  }

  // ── Central directory ──────────────────────────────────────────────────
  const cdParts: Uint8Array[] = [];
  let cdSize = 0;
  const cdOffset = localOffset;

  for (const e of entries) {
    const cd = new Uint8Array(46 + e.nameBytes.length);
    u32(cd,  0, 0x02014b50);         // signature  PK\1\2
    u16(cd,  4, 20);                  // version made by
    u16(cd,  6, 20);                  // version needed
    u16(cd,  8, 0);                   // flags
    u16(cd, 10, 0);                   // compression: STORED
    u16(cd, 12, 0);                   // last mod time
    u16(cd, 14, 0);                   // last mod date
    u32(cd, 16, e.crc);               // CRC-32
    u32(cd, 20, e.data.length);       // compressed size
    u32(cd, 24, e.data.length);       // uncompressed size
    u16(cd, 28, e.nameBytes.length);  // filename length
    u16(cd, 30, 0);                   // extra field length
    u16(cd, 32, 0);                   // file comment length
    u16(cd, 34, 0);                   // disk number start
    u16(cd, 36, 0);                   // internal file attributes
    u32(cd, 38, 0);                   // external file attributes
    u32(cd, 42, e.localOff);          // offset of local header
    cd.set(e.nameBytes, 46);

    cdParts.push(cd);
    cdSize += cd.length;
  }

  // ── End of central directory ───────────────────────────────────────────
  const eocd = new Uint8Array(22);
  u32(eocd,  0, 0x06054b50);         // signature  PK\5\6
  u16(eocd,  4, 0);                   // disk number
  u16(eocd,  6, 0);                   // start disk number
  u16(eocd,  8, entries.length);      // entries on this disk
  u16(eocd, 10, entries.length);      // total entries
  u32(eocd, 12, cdSize);              // central directory size
  u32(eocd, 16, cdOffset);            // central directory offset
  u16(eocd, 20, 0);                   // comment length

  // ── Concatenate ────────────────────────────────────────────────────────
  const all   = [...localParts, ...cdParts, eocd];
  const total = all.reduce((s, p) => s + p.length, 0);
  const out   = new Uint8Array(total);
  let pos = 0;
  for (const p of all) { out.set(p, pos); pos += p.length; }
  return out;
}
