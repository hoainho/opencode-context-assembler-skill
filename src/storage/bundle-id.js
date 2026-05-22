'use strict';

const crypto = require('crypto');

const ALPHA = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const ULID_LENGTH = 26;
const TIME_LEN = 10;
const RAND_LEN = 16;
const ULID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/;

function encodeBase32(value, width) {
  if (value < 0n) throw new RangeError('encodeBase32: value must be non-negative');
  let out = '';
  let v = value;
  for (let i = 0; i < width; i++) {
    const digit = Number(v & 0x1fn);
    out = ALPHA[digit] + out;
    v >>= 5n;
  }
  if (v !== 0n) {
    throw new RangeError(`encodeBase32: value ${value.toString()} overflows ${width}-char output`);
  }
  return out;
}

/**
 * Generate a ULID-shaped bundle id (26-char Crockford base32: excludes I/L/O/U).
 * Replay-determinism contract (Boundary 4): inject `opts.now` and `opts.randomBytes`
 * for fixture mode; production callers pass nothing and get cryptographic randomness.
 * @param {{ now?: () => number, randomBytes?: (n: number) => Buffer }} [opts]
 */
function generateBundleId(opts = {}) {
  const nowFn = opts.now || Date.now;
  const randFn = opts.randomBytes || ((n) => crypto.randomBytes(n));

  const ts = BigInt(nowFn());
  if (ts < 0n) throw new RangeError('generateBundleId: now() must return non-negative timestamp');

  const timePart = encodeBase32(ts, TIME_LEN);

  const rand = randFn(10);
  if (!Buffer.isBuffer(rand) || rand.length !== 10) {
    throw new TypeError('generateBundleId: randomBytes must return Buffer of length 10');
  }
  let randInt = 0n;
  for (const byte of rand) {
    randInt = (randInt << 8n) | BigInt(byte);
  }
  const randPart = encodeBase32(randInt, RAND_LEN);

  return timePart + randPart;
}

function isValidBundleId(id) {
  return typeof id === 'string' && id.length === ULID_LENGTH && ULID_PATTERN.test(id);
}

/**
 * Extract the 48-bit ms-precision timestamp encoded in a ULID.
 * Throws if `id` does not match the ULID pattern.
 */
function extractTimestamp(id) {
  if (!isValidBundleId(id)) {
    throw new TypeError('extractTimestamp: input is not a valid bundle id');
  }
  let value = 0n;
  for (let i = 0; i < TIME_LEN; i++) {
    const ch = id[i];
    const digit = ALPHA.indexOf(ch);
    if (digit < 0) {
      throw new RangeError(`extractTimestamp: invalid char '${ch}' at position ${i}`);
    }
    value = (value << 5n) | BigInt(digit);
  }
  return Number(value);
}

module.exports = {
  ALPHA,
  ULID_LENGTH,
  ULID_PATTERN,
  generateBundleId,
  isValidBundleId,
  extractTimestamp,
};
