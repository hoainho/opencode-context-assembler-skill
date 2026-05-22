'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { capLedgerPath } = require('../storage/bundle-paths');
const { canonicalJSON } = require('../audit/hash');

const DAILY_CAP_AUTO = 5;
const HMAC_ALGO = 'sha256';

function deriveHmacKey(repoRoot) {
  const seedFile = path.join(repoRoot, '.opencode', '.cap-ledger.seed');
  if (fs.existsSync(seedFile)) {
    const seed = fs.readFileSync(seedFile, 'utf8').trim();
    if (seed.length < 32) {
      throw new Error('deriveHmacKey: seed file too short (need >=32 chars)');
    }
    return seed;
  }
  fs.mkdirSync(path.dirname(seedFile), { recursive: true });
  const seed = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(seedFile, seed);
  return seed;
}

function hmacEntry(repoRoot, payload) {
  const key = deriveHmacKey(repoRoot);
  const canonical = canonicalJSON(payload);
  return crypto.createHmac(HMAC_ALGO, key).update(canonical).digest('hex');
}

function dateIsoFromTs(ts) {
  if (typeof ts !== 'string') {
    throw new TypeError('dateIsoFromTs: ts must be ISO 8601 string');
  }
  const m = ts.match(/^(\d{4}-\d{2}-\d{2})T/);
  if (!m) {
    throw new TypeError(`dateIsoFromTs: not ISO 8601: "${ts}"`);
  }
  return m[1];
}

function readLedger(repoRoot) {
  const file = capLedgerPath(repoRoot);
  if (!fs.existsSync(file)) return [];
  const raw = fs.readFileSync(file, 'utf8');
  const entries = [];
  const lines = raw.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.length === 0) continue;
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch (err) {
      throw new Error(`readLedger: invalid JSON at ${file}:${i + 1}: ${err.message}`);
    }
    entries.push(parsed);
  }
  return entries;
}

function verifyLedger(repoRoot) {
  const entries = readLedger(repoRoot);
  for (let i = 0; i < entries.length; i++) {
    const { hmac, ...payload } = entries[i];
    if (typeof hmac !== 'string') {
      throw new Error(`verifyLedger: missing hmac at line ${i + 1}`);
    }
    const expected = hmacEntry(repoRoot, payload);
    if (hmac !== expected) {
      throw new Error(`verifyLedger: HMAC mismatch at line ${i + 1} (tampered)`);
    }
  }
  return { verified: true, count: entries.length };
}

function countByDate(repoRoot, dateIso, kind) {
  const entries = readLedger(repoRoot);
  let count = 0;
  for (const e of entries) {
    if (e.date_iso === dateIso && e.kind === kind) count++;
  }
  return count;
}

function appendBundle({ repoRoot, bundleId, kind, ts }) {
  if (typeof repoRoot !== 'string' || !path.isAbsolute(repoRoot)) {
    throw new TypeError('appendBundle: repoRoot must be absolute');
  }
  if (kind !== 'auto' && kind !== 'user-initiated') {
    throw new TypeError(`appendBundle: kind must be "auto" or "user-initiated", got "${kind}"`);
  }
  if (typeof bundleId !== 'string' || bundleId.length === 0) {
    throw new TypeError('appendBundle: bundleId must be non-empty string');
  }
  if (typeof ts !== 'string') {
    throw new TypeError('appendBundle: ts must be ISO 8601 string');
  }
  const dateIso = dateIsoFromTs(ts);

  if (kind === 'auto') {
    const existing = countByDate(repoRoot, dateIso, 'auto');
    if (existing >= DAILY_CAP_AUTO) {
      throw new Error(
        `BoundaryViolation: artifact cap reached (${existing}/${DAILY_CAP_AUTO} auto bundles on ${dateIso}); next reset ${nextResetDate(dateIso)}`
      );
    }
  }

  const payload = { bundle_id: bundleId, kind, date_iso: dateIso, ts };
  const hmac = hmacEntry(repoRoot, payload);
  const entry = { ...payload, hmac };

  const file = capLedgerPath(repoRoot);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, canonicalJSON(entry) + '\n');
  return { entry, remaining: kind === 'auto' ? DAILY_CAP_AUTO - countByDate(repoRoot, dateIso, 'auto') : null };
}

function nextResetDate(dateIso) {
  const [y, m, d] = dateIso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + 1);
  return dt.toISOString().slice(0, 10);
}

module.exports = {
  DAILY_CAP_AUTO,
  HMAC_ALGO,
  deriveHmacKey,
  hmacEntry,
  dateIsoFromTs,
  readLedger,
  verifyLedger,
  countByDate,
  appendBundle,
  nextResetDate,
};
