'use strict';

const assert = require('assert');
const test = require('node:test');
const { canonicalJSON, sha256 } = require('../../src/audit/hash');

test('canonicalJSON sorts object keys deterministically', () => {
  const a = canonicalJSON({ b: 1, a: 2 });
  const b = canonicalJSON({ a: 2, b: 1 });
  assert.strictEqual(a, b);
  assert.strictEqual(a, '{"a":2,"b":1}');
});

test('canonicalJSON handles nested structures', () => {
  const out = canonicalJSON({ list: [{ z: 1, a: 2 }, { y: 3 }], k: 'v' });
  assert.strictEqual(out, '{"k":"v","list":[{"a":2,"z":1},{"y":3}]}');
});

test('canonicalJSON drops undefined values but preserves null', () => {
  assert.strictEqual(canonicalJSON({ a: 1, b: undefined, c: null }), '{"a":1,"c":null}');
});

test('canonicalJSON serializes primitives', () => {
  assert.strictEqual(canonicalJSON(null), 'null');
  assert.strictEqual(canonicalJSON(true), 'true');
  assert.strictEqual(canonicalJSON(false), 'false');
  assert.strictEqual(canonicalJSON(42), '42');
  assert.strictEqual(canonicalJSON('hi'), '"hi"');
});

test('canonicalJSON rejects non-finite numbers', () => {
  assert.throws(() => canonicalJSON(Infinity), /non-finite/);
  assert.throws(() => canonicalJSON(NaN), /non-finite/);
});

test('canonicalJSON rejects unsupported types', () => {
  assert.throws(() => canonicalJSON(() => 1), /unsupported type/);
  assert.throws(() => canonicalJSON(Symbol('x')), /unsupported type/);
});

test('sha256 returns 64-char lowercase hex', () => {
  const h = sha256('hello');
  assert.strictEqual(h.length, 64);
  assert.match(h, /^[a-f0-9]{64}$/);
});

test('sha256 is deterministic across calls', () => {
  const obj = { z: 1, a: { c: 3, b: 2 } };
  const h1 = sha256(obj);
  const h2 = sha256({ a: { b: 2, c: 3 }, z: 1 });
  assert.strictEqual(h1, h2, 'key order must not affect hash');
});

test('sha256 differs across distinct inputs', () => {
  assert.notStrictEqual(sha256('a'), sha256('b'));
  assert.notStrictEqual(sha256({ x: 1 }), sha256({ x: 2 }));
});
