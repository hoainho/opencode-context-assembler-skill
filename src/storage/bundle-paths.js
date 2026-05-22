'use strict';

const path = require('path');
const { isValidBundleId } = require('./bundle-id');

const BUNDLES_ROOT = path.join('.opencode', 'context-bundles');
const AUDIT_ROOT = path.join('.opencode', 'audit');

function bundleDir(bundleId, repoRoot) {
  if (!isValidBundleId(bundleId)) {
    throw new TypeError(`bundleDir: invalid bundle id "${bundleId}"`);
  }
  if (typeof repoRoot !== 'string' || repoRoot.length === 0) {
    throw new TypeError('bundleDir: repoRoot must be a non-empty string');
  }
  if (!path.isAbsolute(repoRoot)) {
    throw new TypeError(`bundleDir: repoRoot must be absolute, got "${repoRoot}"`);
  }
  return path.join(repoRoot, BUNDLES_ROOT, bundleId);
}

function bundleContextJsonPath(bundleId, repoRoot) {
  return path.join(bundleDir(bundleId, repoRoot), 'bundle.context.json');
}

function bundleContextMdPath(bundleId, repoRoot) {
  return path.join(bundleDir(bundleId, repoRoot), 'bundle.context.md');
}

function bundleLockPath(bundleId, repoRoot) {
  return path.join(bundleDir(bundleId, repoRoot), 'bundle.lock.json');
}

function bundleGapsPath(bundleId, repoRoot) {
  return path.join(bundleDir(bundleId, repoRoot), 'bundle.gaps.md');
}

function bundleRawDir(bundleId, repoRoot) {
  return path.join(bundleDir(bundleId, repoRoot), 'raw');
}

function bundleAuditNdjsonPath(bundleId, repoRoot) {
  return path.join(bundleDir(bundleId, repoRoot), 'audit.ndjson');
}

function indexPath(repoRoot) {
  if (typeof repoRoot !== 'string' || !path.isAbsolute(repoRoot)) {
    throw new TypeError('indexPath: repoRoot must be an absolute path string');
  }
  return path.join(repoRoot, BUNDLES_ROOT, '.index.json');
}

function capLedgerPath(repoRoot) {
  if (typeof repoRoot !== 'string' || !path.isAbsolute(repoRoot)) {
    throw new TypeError('capLedgerPath: repoRoot must be an absolute path string');
  }
  return path.join(repoRoot, BUNDLES_ROOT, '.cap-ledger.ndjson');
}

function auditDir(dateIso, repoRoot) {
  if (typeof dateIso !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dateIso)) {
    throw new TypeError(`auditDir: dateIso must be YYYY-MM-DD, got "${dateIso}"`);
  }
  if (typeof repoRoot !== 'string' || !path.isAbsolute(repoRoot)) {
    throw new TypeError('auditDir: repoRoot must be an absolute path string');
  }
  return path.join(repoRoot, AUDIT_ROOT, dateIso);
}

function auditNdjsonPath(dateIso, bundleId, repoRoot) {
  if (!isValidBundleId(bundleId)) {
    throw new TypeError(`auditNdjsonPath: invalid bundle id "${bundleId}"`);
  }
  return path.join(auditDir(dateIso, repoRoot), `${bundleId}.ndjson`);
}

function auditResultPath(dateIso, sha256, repoRoot) {
  if (typeof sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(sha256)) {
    throw new TypeError(`auditResultPath: sha256 must be 64-char lowercase hex, got "${sha256}"`);
  }
  return path.join(auditDir(dateIso, repoRoot), 'results', `${sha256}.json`);
}

module.exports = {
  BUNDLES_ROOT,
  AUDIT_ROOT,
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
};
