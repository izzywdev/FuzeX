// codec.ts — TypeID-compatible suffix codec: 128-bit UUID <-> 26-char base32.
//
// Independent re-implementation of the algorithm used by
// @izzywdev/fuzefront-identity's codec.ts (governance/identifier-standard.md
// §2/§7 — "same prefixes, same codec, same acceptance and rejection"). This
// module does not depend on that package (see ../README.md for why); it
// reproduces the same TypeID spec (Crockford base32, lowercase, no i/l/o/u)
// so a `fxdf_*` id decodes/round-trips identically to any other TypeID in
// the family, the same way lib/stamp.js independently reimplements
// FuzeFront's stamp-frames.mjs algorithm.

import { randomUUID } from 'node:crypto';

const ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz';
const SUFFIX_LENGTH = 26;

const DECODE: Int8Array = (() => {
  const table = new Int8Array(128).fill(-1);
  for (let i = 0; i < ALPHABET.length; i++) table[ALPHABET.charCodeAt(i)] = i;
  return table;
})();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Encodes 16 bytes as the 26-character base32 TypeID suffix. */
export function encodeSuffix(bytes: Uint8Array): string {
  if (bytes.length !== 16) {
    throw new RangeError(`expected 16 bytes, received ${bytes.length}`);
  }
  let out = '';
  let acc = 0;
  let bits = 2;
  for (let i = 0; i < 16; i++) {
    acc = (acc << 8) | bytes[i];
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += ALPHABET[(acc >>> bits) & 31];
    }
  }
  return out;
}

/** Decodes a 26-character base32 TypeID suffix back to 16 bytes. */
export function decodeSuffix(suffix: string): Uint8Array {
  if (suffix.length !== SUFFIX_LENGTH) {
    throw new RangeError(`suffix must be ${SUFFIX_LENGTH} characters, received ${suffix.length}`);
  }
  const bytes = new Uint8Array(16);
  let acc = 0;
  let bits = 0;
  let index = 0;
  for (let i = 0; i < SUFFIX_LENGTH; i++) {
    const code = suffix.charCodeAt(i);
    const value = code < 128 ? DECODE[code] : -1;
    if (value < 0) {
      throw new RangeError(`invalid base32 character ${JSON.stringify(suffix[i])} at position ${i}`);
    }
    if (i === 0) {
      if (value > 7) throw new RangeError('suffix overflows 128 bits');
      acc = value & 7;
      bits = 3;
      continue;
    }
    acc = (acc << 5) | value;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes[index++] = (acc >>> bits) & 0xff;
    }
  }
  return bytes;
}

export function isValidSuffix(suffix: string): boolean {
  try {
    decodeSuffix(suffix);
    return true;
  } catch {
    return false;
  }
}

export function bytesToUuid(bytes: Uint8Array): string {
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function uuidToBytes(uuid: string): Uint8Array {
  if (!UUID_RE.test(uuid)) {
    throw new RangeError(`not a canonical UUID: ${JSON.stringify(uuid)}`);
  }
  const hex = uuid.replace(/-/g, '');
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

/**
 * Generates UUIDv7 bytes: 48-bit big-endian Unix-ms timestamp, 4-bit version,
 * then random bits (RFC 9562 §5.7). The leading timestamp gives B-tree PK
 * inserts index locality that UUIDv4 throws away.
 */
export function uuidv7Bytes(now: number = Date.now()): Uint8Array {
  const bytes = uuidToBytes(randomUUID());
  const ms = Math.floor(now);
  bytes[0] = (ms / 2 ** 40) & 0xff;
  bytes[1] = (ms / 2 ** 32) & 0xff;
  bytes[2] = (ms / 2 ** 24) & 0xff;
  bytes[3] = (ms / 2 ** 16) & 0xff;
  bytes[4] = (ms / 2 ** 8) & 0xff;
  bytes[5] = ms & 0xff;
  bytes[6] = 0x70 | (bytes[6] & 0x0f); // version 7
  bytes[8] = 0x80 | (bytes[8] & 0x3f); // RFC 9562 variant
  return bytes;
}
