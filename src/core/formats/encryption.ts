/**
 * PSO download-quest encryption.
 *
 * Ported from CreateKey / MixKey / PSOEnc in main.pas.
 * Used only for DC download format (.qst with first byte 0xA6).
 *
 * Encrypted file layout:
 *   [0..2]  3 bytes  original uncompressed size (LE)
 *   [3]     1 byte   padding (0x00)
 *   [4..7]  4 bytes  seed (LE u32)
 *   [8..]   N bytes  encrypted+compressed payload
 */

interface PlayerKey {
  key: [Uint32Array, Uint32Array]; // two 60-dword buffers
  keyPos: number;
  recKeyPos: number;
}

function mixKey(pk: PlayerKey, buff: 0 | 1): void {
  const k = pk.key[buff];
  // Pass 1: indices 1..24, k[i] -= k[i + 0x1F]
  for (let i = 1; i <= 0x18; i++) {
    k[i] = (k[i] - k[i + 0x1f]) >>> 0;
  }
  // Pass 2: indices 0x19..0x37, k[i] -= k[i - 0x18]
  for (let i = 0x19; i <= 0x37; i++) {
    k[i] = (k[i] - k[i - 0x18]) >>> 0;
  }
}

function createKey(seed: number): PlayerKey {
  const key = new Uint32Array(61);
  key[56] = seed >>> 0;
  key[55] = seed >>> 0;

  // Delphi: esi := 1; ebx := val; then each iteration:
  //   ebx := ebx - esi; Key[edx] := esi; esi := ebx; ebx := Key[edx]
  // → esi/ebx swap with subtraction (Fibonacci-like LFG sequence).
  let esi = 1;
  let ebx = seed >>> 0;
  let edi = 0x15;
  while (edi <= 0x46e) {
    const edx = edi % 0x37;
    ebx = (ebx - esi) >>> 0;
    edi += 0x15;
    key[edx] = esi;
    esi = ebx;
    ebx = key[edx]; // reload saved esi (completing the swap)
  }

  const pk: PlayerKey = {
    key: [new Uint32Array(60), new Uint32Array(60)],
    keyPos: 4,
    recKeyPos: 4,
  };

  for (let x = 0; x < 60; x++) pk.key[0][x] = key[x];
  mixKey(pk, 0);
  mixKey(pk, 0);
  mixKey(pk, 0);
  mixKey(pk, 0);
  for (let x = 0; x < 60; x++) pk.key[1][x] = pk.key[0][x];

  return pk;
}

/** XOR-decrypt/encrypt a buffer using the PSO key stream (in-place). */
export function psoDecrypt(data: Uint8Array, seed: number): void {
  const pk = createKey(seed);
  // The key is treated as a byte array: 60 × 4 = 240 bytes, positions 4..223 active
  const keyBytes = new Uint8Array(pk.key[0].buffer);

  let x = pk.keyPos; // starts at 4

  for (let z = 0; z < data.length; z++) {
    if (x === 4) mixKey(pk, 0);

    // After mixKey, rebuild keyBytes view (Uint32Array mutation affects the view)
    data[z] ^= keyBytes[x];
    x++;
    if (x === 224) x = 4;
  }
}

/**
 * Parse an encrypted download-quest buffer.
 * Returns { seed, payload } where payload is the raw (still PRS-compressed) data.
 */
export function parseEncryptedWrapper(buf: Uint8Array): { seed: number; payload: Uint8Array } {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const seed = view.getUint32(4, true); // LE
  const payload = buf.slice(8);
  psoDecrypt(payload, seed);
  return { seed, payload };
}

/**
 * Wrap PRS-compressed data with the PSO download-quest encryption header.
 *
 * Output layout (mirrors the input layout of parseEncryptedWrapper):
 *   [0..2]  3 bytes  original uncompressed size (LE)
 *   [3]     1 byte   padding (0x00)
 *   [4..7]  4 bytes  random seed (LE u32)
 *   [8..]   N bytes  XOR-encrypted copy of compressedData
 *
 * The returned buffer's length (compressedData.length + 8) is what the
 * create-packet size field must carry so the receiver knows how many bytes
 * to accumulate from file-data chunks.
 */
export function buildEncryptedWrapper(compressedData: Uint8Array, uncompressedSize: number): Uint8Array {
  const seed = (Math.random() * 0x7FFFFFFF) >>> 0;
  // Copy before encrypting — psoDecrypt mutates in-place.
  const encrypted = new Uint8Array(compressedData);
  psoDecrypt(encrypted, seed);

  const out  = new Uint8Array(8 + encrypted.length);
  out[0] =  uncompressedSize        & 0xff;
  out[1] = (uncompressedSize >>  8) & 0xff;
  out[2] = (uncompressedSize >> 16) & 0xff;
  // out[3] = 0x00  (padding, already zero)
  new DataView(out.buffer).setUint32(4, seed, true);
  out.set(encrypted, 8);
  return out;
}
