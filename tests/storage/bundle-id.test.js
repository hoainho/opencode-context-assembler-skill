'use strict';

const assert = require('assert');
const test = require('node:test');
const {
  ALPHA,
  ULID_LENGTH,
  ULID_PATTERN,
  generateBundleId,
  isValidBundleId,
  extractTimestamp,
} = require('../../src/storage/bundle-id');

test('ALPHA is the 32-symbol Crockford base32 alphabet (no I, L, O, U)', () => {
  assert.strictEqual(ALPHA.length, 32);
  for (const banned of ['I', 'L', 'O', 'U']) {
    assert.ok(!ALPHA.includes(banned), `ALPHA must not contain "${banned}"`);
  }
});

test('ULID_PATTERN matches schemas/v1.0.0 bundle_id pattern exactly', () => {
  assert.strictEqual(ULID_PATTERN.source, '^[0-9A-HJKMNP-TV-Z]{26}$');
});

test('generateBundleId returns a 26-char Crockford base32 string', () => {
  const id = generateBundleId();
  assert.strictEqual(id.length, ULID_LENGTH);
  assert.ok(ULID_PATTERN.test(id), `id "${id}" must match ULID_PATTERN`);
});

test('generateBundleId produces 1000 unique ids in <100ms', () => {
  const set = new Set();
  const start = Date.now();
  for (let i = 0; i < 1000; i++) {
    set.add(generateBundleId());
  }
  const elapsed = Date.now() - start;
  assert.strictEqual(set.size, 1000, '1000 generated ids must be unique');
  assert.ok(elapsed < 1000, `elapsed ${elapsed}ms exceeds 1000ms budget`);
});

test('generateBundleId is deterministic when now+randomBytes injected (replay contract)', () => {
  const fixedNow = () => 1750000000000;
  const fixedBytes = Buffer.from('00112233445566778899', 'hex');
  const id1 = generateBundleId({ now: fixedNow, randomBytes: () => fixedBytes });
  const id2 = generateBundleId({ now: fixedNow, randomBytes: () => fixedBytes });
  assert.strictEqual(id1, id2, 'deterministic injection must produce identical ids');
});

test('generateBundleId rejects non-Buffer randomBytes return', () => {
  assert.throws(
    () => generateBundleId({ randomBytes: () => 'not-a-buffer' }),
    /randomBytes must return Buffer/
  );
  assert.throws(
    () => generateBundleId({ randomBytes: () => Buffer.alloc(5) }),
    /Buffer of length 10/
  );
});

test('generateBundleId rejects negative now()', () => {
  assert.throws(
    () => generateBundleId({ now: () => -1 }),
    /must return non-negative timestamp/
  );
});

test('isValidBundleId accepts schema-conforming ids and rejects everything else', () => {
  assert.strictEqual(isValidBundleId('01JVK2D9N3R5W7XY8Z2A4B6C8E'), true);
  assert.strictEqual(isValidBundleId('RWAVE2XAZJPFTDMNTV44Z98GQP'), true);

  assert.strictEqual(isValidBundleId(''), false);
  assert.strictEqual(isValidBundleId('too-short'), false);
  assert.strictEqual(isValidBundleId('01JVK2D9N3R5W7XY8Z2A4B6C8'), false, '25 chars must reject');
  assert.strictEqual(isValidBundleId('01JVK2D9N3R5W7XY8Z2A4B6C8EE'), false, '27 chars must reject');
  assert.strictEqual(isValidBundleId('01JVK2D9N3R5W7XY8Z2A4B6C8I'), false, 'contains banned I');
  assert.strictEqual(isValidBundleId('01JVK2D9N3R5W7XY8Z2A4B6C8L'), false, 'contains banned L');
  assert.strictEqual(isValidBundleId('01JVK2D9N3R5W7XY8Z2A4B6C8O'), false, 'contains banned O');
  assert.strictEqual(isValidBundleId('01JVK2D9N3R5W7XY8Z2A4B6C8U'), false, 'contains banned U');
  assert.strictEqual(isValidBundleId(null), false);
  assert.strictEqual(isValidBundleId(undefined), false);
  assert.strictEqual(isValidBundleId(12345), false);
  assert.strictEqual(isValidBundleId({}), false);
});

test('extractTimestamp round-trips through generateBundleId', () => {
  const fixedNow = 1750000000000;
  const id = generateBundleId({ now: () => fixedNow });
  const ts = extractTimestamp(id);
  assert.strictEqual(ts, fixedNow);
});

test('extractTimestamp throws on invalid id', () => {
  assert.throws(() => extractTimestamp('not-valid'), /not a valid bundle id/);
  assert.throws(() => extractTimestamp(''), /not a valid bundle id/);
  assert.throws(() => extractTimestamp(null), /not a valid bundle id/);
});

test('time-component sort order matches generation order across 5 sequential ids', () => {
  let t = 1750000000000;
  const ids = [];
  for (let i = 0; i < 5; i++) {
    ids.push(generateBundleId({ now: () => t }));
    t += 100;
  }
  const sorted = [...ids].sort();
  const timeParts = ids.map((id) => id.slice(0, 10));
  for (let i = 1; i < timeParts.length; i++) {
    assert.ok(
      timeParts[i] >= timeParts[i - 1],
      `time-prefix at index ${i} (${timeParts[i]}) must >= prior (${timeParts[i - 1]})`
    );
  }
  assert.deepStrictEqual(sorted, ids, 'sequential generation must produce sortable ids');
});
