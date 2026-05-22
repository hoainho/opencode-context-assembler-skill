'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const {
  DAILY_CAP_AUTO,
  deriveHmacKey,
  hmacEntry,
  readLedger,
  verifyLedger,
  countByDate,
  appendBundle,
  nextResetDate,
} = require('../../src/boundaries/cap-ledger');

const VALID_ID_1 = '01JVK2D9N3R5W7XY8Z2A4B6C8E';
const VALID_ID_2 = 'RWAVE2XAZJPFTDMNTV44Z98GQP';
const VALID_ID_3 = 'NBTVVQ0PYAD4F7KJ8Y2T3Q3WVW';
const VALID_ID_4 = '98MNFDCS0PF2QMBRBB08MEEVCV';
const VALID_ID_5 = 'SPJBWKJ1TXQ51GHE94W6N37HPB';
const VALID_ID_6 = '01JX5HY28K7M3P9R4T6V8W2X4Z';

function tempRepo() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cba-cap-'));
}

test('DAILY_CAP_AUTO = 5 per Section 0 #2 lock', () => {
  assert.strictEqual(DAILY_CAP_AUTO, 5);
});

test('deriveHmacKey creates seed file with >=32 chars on first call', () => {
  const repo = tempRepo();
  const k1 = deriveHmacKey(repo);
  const k2 = deriveHmacKey(repo);
  assert.strictEqual(k1, k2, 'seed must be stable across calls');
  assert.ok(k1.length >= 32);
});

test('deriveHmacKey rejects short seed file', () => {
  const repo = tempRepo();
  fs.mkdirSync(path.join(repo, '.opencode'), { recursive: true });
  fs.writeFileSync(path.join(repo, '.opencode', '.cap-ledger.seed'), 'tooshort');
  assert.throws(() => deriveHmacKey(repo), /seed file too short/);
});

test('hmacEntry deterministic over canonical JSON', () => {
  const repo = tempRepo();
  const a = hmacEntry(repo, { b: 2, a: 1 });
  const b = hmacEntry(repo, { a: 1, b: 2 });
  assert.strictEqual(a, b);
});

test('countByDate returns 0 on empty ledger', () => {
  const repo = tempRepo();
  assert.strictEqual(countByDate(repo, '2026-05-22', 'auto'), 0);
});

test('appendBundle (kind=auto) increments count and respects cap', () => {
  const repo = tempRepo();
  const ts = '2026-05-22T08:00:00Z';
  for (let i = 0; i < DAILY_CAP_AUTO; i++) {
    const r = appendBundle({ repoRoot: repo, bundleId: [VALID_ID_1, VALID_ID_2, VALID_ID_3, VALID_ID_4, VALID_ID_5][i], kind: 'auto', ts });
    assert.strictEqual(r.entry.kind, 'auto');
    assert.strictEqual(r.remaining, DAILY_CAP_AUTO - (i + 1));
  }
  assert.strictEqual(countByDate(repo, '2026-05-22', 'auto'), 5);
  assert.throws(
    () => appendBundle({ repoRoot: repo, bundleId: VALID_ID_6, kind: 'auto', ts }),
    /BoundaryViolation: artifact cap reached \(5\/5/
  );
});

test('appendBundle (kind=user-initiated) bypasses the cap', () => {
  const repo = tempRepo();
  const ts = '2026-05-22T08:00:00Z';
  for (let i = 0; i < 5; i++) {
    appendBundle({ repoRoot: repo, bundleId: [VALID_ID_1, VALID_ID_2, VALID_ID_3, VALID_ID_4, VALID_ID_5][i], kind: 'auto', ts });
  }
  for (let i = 0; i < 10; i++) {
    const r = appendBundle({ repoRoot: repo, bundleId: VALID_ID_6, kind: 'user-initiated', ts });
    assert.strictEqual(r.entry.kind, 'user-initiated');
    assert.strictEqual(r.remaining, null);
  }
  assert.strictEqual(countByDate(repo, '2026-05-22', 'auto'), 5);
  assert.strictEqual(countByDate(repo, '2026-05-22', 'user-initiated'), 10);
});

test('appendBundle counts reset across dates', () => {
  const repo = tempRepo();
  appendBundle({ repoRoot: repo, bundleId: VALID_ID_1, kind: 'auto', ts: '2026-05-22T23:59:00Z' });
  for (let i = 0; i < 5; i++) {
    appendBundle({ repoRoot: repo, bundleId: [VALID_ID_2, VALID_ID_3, VALID_ID_4, VALID_ID_5, VALID_ID_6][i], kind: 'auto', ts: '2026-05-23T00:01:00Z' });
  }
  assert.strictEqual(countByDate(repo, '2026-05-22', 'auto'), 1);
  assert.strictEqual(countByDate(repo, '2026-05-23', 'auto'), 5);
});

test('appendBundle rejects bad kind/bundleId/repoRoot/ts', () => {
  const repo = tempRepo();
  assert.throws(
    () => appendBundle({ repoRoot: repo, bundleId: VALID_ID_1, kind: 'unknown', ts: '2026-05-22T00:00:00Z' }),
    /kind must be/
  );
  assert.throws(
    () => appendBundle({ repoRoot: repo, bundleId: '', kind: 'auto', ts: '2026-05-22T00:00:00Z' }),
    /bundleId/
  );
  assert.throws(
    () => appendBundle({ repoRoot: 'rel', bundleId: VALID_ID_1, kind: 'auto', ts: '2026-05-22T00:00:00Z' }),
    /must be absolute/
  );
  assert.throws(
    () => appendBundle({ repoRoot: repo, bundleId: VALID_ID_1, kind: 'auto', ts: 'not-iso' }),
    /not ISO 8601/
  );
});

test('verifyLedger detects HMAC tamper', () => {
  const repo = tempRepo();
  const ts = '2026-05-22T08:00:00Z';
  appendBundle({ repoRoot: repo, bundleId: VALID_ID_1, kind: 'auto', ts });
  appendBundle({ repoRoot: repo, bundleId: VALID_ID_2, kind: 'auto', ts });

  assert.strictEqual(verifyLedger(repo).verified, true);

  const ledgerFile = path.join(repo, '.opencode', 'context-bundles', '.cap-ledger.ndjson');
  const raw = fs.readFileSync(ledgerFile, 'utf8');
  fs.writeFileSync(ledgerFile, raw.replace(VALID_ID_1, VALID_ID_6));
  assert.throws(() => verifyLedger(repo), /HMAC mismatch/);
});

test('verifyLedger throws on missing hmac field', () => {
  const repo = tempRepo();
  const ledgerFile = path.join(repo, '.opencode', 'context-bundles', '.cap-ledger.ndjson');
  fs.mkdirSync(path.dirname(ledgerFile), { recursive: true });
  fs.writeFileSync(ledgerFile, JSON.stringify({ bundle_id: VALID_ID_1 }) + '\n');
  assert.throws(() => verifyLedger(repo), /missing hmac/);
});

test('readLedger throws on corrupt JSON', () => {
  const repo = tempRepo();
  const ledgerFile = path.join(repo, '.opencode', 'context-bundles', '.cap-ledger.ndjson');
  fs.mkdirSync(path.dirname(ledgerFile), { recursive: true });
  fs.writeFileSync(ledgerFile, 'not-json\n');
  assert.throws(() => readLedger(repo), /invalid JSON/);
});

test('nextResetDate returns the next-day YYYY-MM-DD', () => {
  assert.strictEqual(nextResetDate('2026-05-22'), '2026-05-23');
  assert.strictEqual(nextResetDate('2026-05-31'), '2026-06-01');
  assert.strictEqual(nextResetDate('2026-12-31'), '2027-01-01');
});
