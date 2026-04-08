/**
 * PRS (Pika) compression used in PSO quest files.
 *
 * Direct port of PikaDecompress / PikaCompress from PikaPackage.pas.
 * The algorithm is a bit-stream LZ77 variant where:
 *   bit 1         → literal byte copy
 *   bits 01       → long back-reference  (up to 8191 bytes back, up to 256+)
 *   bits 00 xx    → short back-reference (up to 255 bytes back, 2-5 bytes)
 */

// ─── Decompress ────────────────────────────────────────────────────────────

export function prsDecompress(input: Uint8Array): Uint8Array {
  // Worst-case output: heuristic upper bound (10 MB cap to stay safe)
  const out = new Uint8Array(10_000_000);
  let ptr = 0;        // read position in input
  let destPtr = 0;    // write position in output
  let curByte = 0;
  let curBit = 0;

  function getBit(): number {
    if (curBit === 0) {
      curByte = input[ptr++];
      curBit = 8;
    }
    const bit = curByte & 1;
    curByte >>= 1;
    curBit--;
    return bit;
  }

  function getByte(): number {
    return input[ptr++];
  }

  while (ptr < input.length) {
    if (getBit() === 1) {
      // Literal copy
      out[destPtr++] = getByte();
    } else if (getBit() === 1) {
      // Long back-reference: 2 bytes encode offset + optional count byte
      const lo = getByte();
      const hi = getByte();
      const raw = lo | (hi << 8);

      if (raw === 0) {
        // End-of-stream marker
        break;
      }

      let count = raw & 7;
      if (count !== 0) {
        count += 2;
      } else {
        count = getByte() + 1;
      }

      const off = (raw >> 3) - 8192; // negative offset from destPtr
      // memfwdcpy — must copy forward byte-by-byte to support overlapping runs
      for (let i = 0; i < count; i++) {
        out[destPtr] = out[destPtr + off];
        destPtr++;
      }
    } else {
      // Short back-reference: 2 control bits + 1 offset byte
      const b1 = getBit();
      const b0 = getBit();
      const count = (b1 << 1) + b0 + 2; // 2..5  (Delphi: (getbit*2)+getbit+2)
      const off = getByte() - 256;       // negative offset from destPtr
      for (let i = 0; i < count; i++) {
        out[destPtr] = out[destPtr + off];
        destPtr++;
      }
    }
  }

  return out.slice(0, destPtr);
}

// ─── Compress ──────────────────────────────────────────────────────────────

export function prsCompress(input: Uint8Array): Uint8Array {
  // Output buffer: worst case slightly larger than input
  const out = new Uint8Array(input.length * 2 + 16);
  let ptr = 0;        // write position in out
  let p = 0;          // read position in input
  let curBit = 0;
  let curbyte = 0;
  let pendingStart = 0; // where the pending-bytes block starts in out

  // Reserve space for the bit-group header byte
  pendingStart = ptr++;
  // (ptr now points to first data byte slot)

  function putBit(b: number): void {
    if (curBit === 8) {
      out[pendingStart] = curbyte;
      pendingStart = ptr++;
      curbyte = 0;
      curBit = 0;
    }
    curbyte = (curbyte >> 1) | (b ? 0x80 : 0);
    curBit++;
  }

  function putLiteral(b: number): void {
    out[ptr++] = b;
  }

  /** Find the best back-reference at position pos. Returns {offset, count} or null. */
  function findMatch(pos: number): { offset: number; count: number } | null {
    let bestOff = 0;
    let bestCount = 0;
    const searchStart = Math.max(0, pos - 8191);

    for (let x = pos - 1; x >= searchStart; x--) {
      if (input[x] !== input[pos]) continue;
      let c = 1;
      const maxC = Math.min(255, input.length - pos - 1);
      while (c <= maxC && input[x + c] === input[pos + c]) c++;
      if (c > bestCount) {
        bestCount = c;
        bestOff = pos - x;
        if (c === 256) break;
      }
    }

    if (bestOff > 255) {
      if (bestCount > 2) return { offset: bestOff, count: bestCount };
    } else if (bestCount > 1) {
      return { offset: bestOff, count: bestCount };
    }
    return null;
  }

  while (p < input.length) {
    const match = findMatch(p);

    if (match === null) {
      // Literal
      putBit(1);
      putLiteral(input[p++]);
    } else {
      let { offset, count } = match;
      if (p + count > input.length) count = input.length - p;

      if (count < 3) {
        // Not worth encoding — emit as literals
        while (count-- > 0) {
          putBit(1);
          putLiteral(input[p++]);
        }
      } else if (offset > 255 || count > 5) {
        // Long reference
        const rawOff = 8192 - offset;
        const rawCount = count < 10 ? count - 2 : 0;
        const raw = (rawOff << 3) | rawCount;
        putBit(0);
        putBit(1);
        putLiteral(raw & 0xff);
        putLiteral((raw >> 8) & 0xff);
        if (count > 9) putLiteral(count - 1);
        p += count;
      } else {
        // Short reference
        const c2 = count - 2;
        putBit(0);
        putBit(0);
        putBit((c2 >> 1) & 1);
        putBit(c2 & 1);
        putLiteral(256 - offset);
        p += count;
      }
    }
  }

  // End-of-stream: bits 01 followed by two zero bytes + padding
  putBit(0);
  putBit(1);
  putLiteral(0);
  putLiteral(0);
  putLiteral(0);
  // pad remaining bits in the current group to 0
  while (curBit > 0 && curBit < 8) putBit(0);
  // flush final bit-group header
  out[pendingStart] = curbyte;

  return out.slice(0, ptr);
}
