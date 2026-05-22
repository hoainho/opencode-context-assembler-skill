'use strict';

const fs = require('fs');
const path = require('path');
const { canonicalJSON, sha256 } = require('./hash');
const { auditDir, auditNdjsonPath, auditResultPath } = require('../storage/bundle-paths');
const { isValidBundleId } = require('../storage/bundle-id');

const VALID_ACTIONS = new Set([
  'mcp.call',
  'bash.exec',
  'file.write',
  'phase.transition',
  'compaction',
  'gap.emit',
  'throttle.event',
]);

const VALID_PHASES = new Set(['0', '1', '1.5', '2', '3', '4']);

function dateIsoFromTimestamp(tsIso) {
  if (typeof tsIso !== 'string') {
    throw new TypeError('dateIsoFromTimestamp: ts must be ISO 8601 string');
  }
  const m = tsIso.match(/^(\d{4}-\d{2}-\d{2})T/);
  if (!m) {
    throw new TypeError(`dateIsoFromTimestamp: not ISO 8601: "${tsIso}"`);
  }
  return m[1];
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function validateEntry(entry) {
  if (!entry || typeof entry !== 'object') {
    throw new TypeError('validateEntry: entry must be an object');
  }
  const required = ['ts', 'actor', 'phase', 'action', 'args', 'result_hash', 'duration_ms'];
  for (const key of required) {
    if (entry[key] === undefined) {
      throw new TypeError(`validateEntry: missing required field "${key}"`);
    }
  }
  if (typeof entry.ts !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(entry.ts)) {
    throw new TypeError(`validateEntry: ts must be ISO 8601, got "${entry.ts}"`);
  }
  if (typeof entry.actor !== 'string' || entry.actor.length === 0) {
    throw new TypeError('validateEntry: actor must be non-empty string');
  }
  if (typeof entry.phase !== 'string' || !VALID_PHASES.has(entry.phase)) {
    throw new TypeError(`validateEntry: phase must be one of [${[...VALID_PHASES].join(', ')}], got "${entry.phase}"`);
  }
  if (typeof entry.action !== 'string' || !VALID_ACTIONS.has(entry.action)) {
    throw new TypeError(`validateEntry: action must be one of [${[...VALID_ACTIONS].join(', ')}], got "${entry.action}"`);
  }
  if (typeof entry.args !== 'object' || entry.args === null) {
    throw new TypeError('validateEntry: args must be an object');
  }
  if (typeof entry.result_hash !== 'string' || !/^[a-f0-9]{64}$/.test(entry.result_hash)) {
    throw new TypeError(`validateEntry: result_hash must be 64-char lowercase hex, got "${entry.result_hash}"`);
  }
  if (typeof entry.duration_ms !== 'number' || entry.duration_ms < 0 || !Number.isFinite(entry.duration_ms)) {
    throw new TypeError(`validateEntry: duration_ms must be non-negative finite number, got "${entry.duration_ms}"`);
  }
}

function appendEntry({ repoRoot, bundleId, entry, resultBody }) {
  if (typeof repoRoot !== 'string' || !path.isAbsolute(repoRoot)) {
    throw new TypeError('appendEntry: repoRoot must be absolute path');
  }
  if (!isValidBundleId(bundleId)) {
    throw new TypeError(`appendEntry: invalid bundleId "${bundleId}"`);
  }
  validateEntry(entry);

  if (resultBody !== undefined && resultBody !== null) {
    const expectedHash = sha256(resultBody);
    if (expectedHash !== entry.result_hash) {
      throw new Error(
        `appendEntry: result_hash mismatch — entry says ${entry.result_hash} but resultBody hash is ${expectedHash}`
      );
    }
  }

  const dateIso = dateIsoFromTimestamp(entry.ts);
  const dir = auditDir(dateIso, repoRoot);
  ensureDir(dir);
  ensureDir(path.join(dir, 'results'));

  if (resultBody !== undefined && resultBody !== null) {
    const resultPath = auditResultPath(dateIso, entry.result_hash, repoRoot);
    if (!fs.existsSync(resultPath)) {
      const body = typeof resultBody === 'string' ? resultBody : canonicalJSON(resultBody);
      const tmp = `${resultPath}.tmp`;
      fs.writeFileSync(tmp, body);
      fs.renameSync(tmp, resultPath);
    }
  }

  const ndjsonPath = auditNdjsonPath(dateIso, bundleId, repoRoot);
  const line = canonicalJSON(entry) + '\n';
  fs.appendFileSync(ndjsonPath, line);

  return { ndjsonPath, dateIso };
}

function readEntries({ repoRoot, bundleId, dateIso }) {
  if (!isValidBundleId(bundleId)) {
    throw new TypeError(`readEntries: invalid bundleId "${bundleId}"`);
  }
  const file = auditNdjsonPath(dateIso, bundleId, repoRoot);
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
      throw new Error(`readEntries: invalid JSON at ${file}:${i + 1}: ${err.message}`);
    }
    try {
      validateEntry(parsed);
    } catch (err) {
      throw new Error(`readEntries: invalid entry at ${file}:${i + 1}: ${err.message}`);
    }
    entries.push(parsed);
  }
  return entries;
}

module.exports = {
  VALID_ACTIONS,
  VALID_PHASES,
  dateIsoFromTimestamp,
  validateEntry,
  appendEntry,
  readEntries,
};
