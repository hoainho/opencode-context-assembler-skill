'use strict';

const assert = require('assert');
const path = require('path');
const test = require('node:test');
const {
  BUNDLES_ROOT,
  bundleDir,
  bundleContextJsonPath,
  bundleContextMdPath,
  bundleLockPath,
  bundleGapsPath,
  bundleRawDir,
  bundleAuditNdjsonPath,
  indexPath,
  capLedgerPath,
  auditDir,
  auditNdjsonPath,
  auditResultPath,
} = require('../../src/storage/bundle-paths');

const VALID_ID = '01JVK2D9N3R5W7XY8Z2A4B6C8E';
const REPO = '/tmp/repo';

test('BUNDLES_ROOT is the .opencode/context-bundles literal', () => {
  assert.strictEqual(BUNDLES_ROOT, path.join('.opencode', 'context-bundles'));
});

test('bundleDir returns absolute path inside .opencode/context-bundles/', () => {
  const dir = bundleDir(VALID_ID, REPO);
  assert.ok(path.isAbsolute(dir));
  assert.ok(dir.startsWith(path.join(REPO, '.opencode', 'context-bundles')));
  assert.ok(dir.endsWith(VALID_ID));
});

test('bundleDir rejects invalid bundle id', () => {
  assert.throws(() => bundleDir('not-a-ulid', REPO), /invalid bundle id/);
});

test('bundleDir rejects relative repoRoot (security)', () => {
  assert.throws(() => bundleDir(VALID_ID, 'relative/path'), /must be absolute/);
  assert.throws(() => bundleDir(VALID_ID, ''), /must be a non-empty string/);
});

test('bundle*Path utilities all live under bundleDir', () => {
  const dir = bundleDir(VALID_ID, REPO);
  assert.strictEqual(bundleContextJsonPath(VALID_ID, REPO), path.join(dir, 'bundle.context.json'));
  assert.strictEqual(bundleContextMdPath(VALID_ID, REPO), path.join(dir, 'bundle.context.md'));
  assert.strictEqual(bundleLockPath(VALID_ID, REPO), path.join(dir, 'bundle.lock.json'));
  assert.strictEqual(bundleGapsPath(VALID_ID, REPO), path.join(dir, 'bundle.gaps.md'));
  assert.strictEqual(bundleRawDir(VALID_ID, REPO), path.join(dir, 'raw'));
  assert.strictEqual(bundleAuditNdjsonPath(VALID_ID, REPO), path.join(dir, 'audit.ndjson'));
});

test('indexPath and capLedgerPath live at bundles root, not inside a bundle', () => {
  assert.strictEqual(indexPath(REPO), path.join(REPO, '.opencode', 'context-bundles', '.index.json'));
  assert.strictEqual(capLedgerPath(REPO), path.join(REPO, '.opencode', 'context-bundles', '.cap-ledger.ndjson'));
});

test('auditDir uses YYYY-MM-DD format strictly', () => {
  assert.strictEqual(auditDir('2026-05-22', REPO), path.join(REPO, '.opencode', 'audit', '2026-05-22'));
  assert.throws(() => auditDir('05-22-2026', REPO), /YYYY-MM-DD/);
  assert.throws(() => auditDir('2026-5-22', REPO), /YYYY-MM-DD/);
  assert.throws(() => auditDir('not-a-date', REPO), /YYYY-MM-DD/);
});

test('auditNdjsonPath rejects invalid bundle id', () => {
  assert.throws(() => auditNdjsonPath('2026-05-22', 'bad-id', REPO), /invalid bundle id/);
});

test('auditResultPath enforces SHA-256 lowercase hex pattern', () => {
  const validHash = 'a'.repeat(64);
  assert.strictEqual(
    auditResultPath('2026-05-22', validHash, REPO),
    path.join(REPO, '.opencode', 'audit', '2026-05-22', 'results', `${validHash}.json`)
  );
  assert.throws(() => auditResultPath('2026-05-22', 'A'.repeat(64), REPO), /lowercase hex/);
  assert.throws(() => auditResultPath('2026-05-22', 'short', REPO), /lowercase hex/);
  assert.throws(() => auditResultPath('2026-05-22', 'g'.repeat(64), REPO), /lowercase hex/);
});

test('all path utilities reject relative repoRoot', () => {
  for (const fn of [
    () => bundleDir(VALID_ID, 'rel'),
    () => indexPath('rel'),
    () => capLedgerPath('rel'),
    () => auditDir('2026-05-22', 'rel'),
  ]) {
    assert.throws(fn, /must be (an )?absolute|non-empty string/);
  }
});
