'use strict';

const fs = require('fs');
const path = require('path');
const { canonicalJSON, sha256 } = require('./hash');
const { readEntries, dateIsoFromTimestamp } = require('./writer');
const { auditResultPath, bundleLockPath, bundleContextJsonPath } = require('../storage/bundle-paths');
const { isValidBundleId } = require('../storage/bundle-id');

function readResult({ repoRoot, dateIso, resultHash }) {
  const file = auditResultPath(dateIso, resultHash, repoRoot);
  if (!fs.existsSync(file)) {
    throw new Error(`readResult: cached result missing at ${file}`);
  }
  return fs.readFileSync(file, 'utf8');
}

function replayBundle({ repoRoot, bundleId, dateIso, mode }) {
  if (typeof repoRoot !== 'string' || !path.isAbsolute(repoRoot)) {
    throw new TypeError('replayBundle: repoRoot must be absolute');
  }
  if (!isValidBundleId(bundleId)) {
    throw new TypeError(`replayBundle: invalid bundleId "${bundleId}"`);
  }
  if (typeof dateIso !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dateIso)) {
    throw new TypeError(`replayBundle: dateIso must be YYYY-MM-DD, got "${dateIso}"`);
  }
  if (mode !== 'no-fetch' && mode !== 'live') {
    throw new TypeError(`replayBundle: mode must be "no-fetch" or "live", got "${mode}"`);
  }
  if (mode === 'live') {
    throw new Error('replayBundle: mode=live not implemented in v1 (requires connector wiring; comes in PR 14)');
  }

  const entries = readEntries({ repoRoot, bundleId, dateIso });
  if (entries.length === 0) {
    throw new Error(`replayBundle: no audit entries for ${bundleId} on ${dateIso}`);
  }

  const verified = [];
  for (const entry of entries) {
    const expectedHash = entry.result_hash;
    const actualBody = readResult({ repoRoot, dateIso, resultHash: expectedHash });
    const actualHash = sha256(actualBody);
    if (actualHash !== expectedHash) {
      throw new Error(
        `replayBundle: hash mismatch at entry ts=${entry.ts}: audit=${expectedHash} cached=${actualHash}`
      );
    }
    verified.push({ entry, hash: actualHash });
  }

  const lockFile = bundleLockPath(bundleId, repoRoot);
  let lockHash = null;
  if (fs.existsSync(lockFile)) {
    const lock = JSON.parse(fs.readFileSync(lockFile, 'utf8'));
    lockHash = lock.hash;
  } else {
    const ctxFile = bundleContextJsonPath(bundleId, repoRoot);
    if (fs.existsSync(ctxFile)) {
      const ctx = JSON.parse(fs.readFileSync(ctxFile, 'utf8'));
      lockHash = ctx.hash;
    }
  }

  const auditDigest = sha256({
    bundle_id: bundleId,
    entries: verified.map(({ entry, hash }) => ({
      ts: entry.ts,
      action: entry.action,
      phase: entry.phase,
      result_hash: hash,
    })),
  });

  return {
    bundle_id: bundleId,
    date_iso: dateIso,
    mode,
    entry_count: verified.length,
    bundle_hash: lockHash,
    audit_digest: auditDigest,
    verified: true,
  };
}

module.exports = {
  readResult,
  replayBundle,
};
