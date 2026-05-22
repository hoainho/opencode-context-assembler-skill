'use strict';

const fs = require('fs');
const path = require('path');
const { isValidBundleId } = require('./bundle-id');
const { indexPath } = require('./bundle-paths');

function readIndex(repoRoot) {
  const file = indexPath(repoRoot);
  if (!fs.existsSync(file)) {
    return { schema_version: '1.0.0', entries: {} };
  }
  const raw = fs.readFileSync(file, 'utf8');
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`readIndex: corrupt JSON at ${file}: ${err.message}`);
  }
  if (!parsed || typeof parsed !== 'object' || parsed.schema_version !== '1.0.0' || typeof parsed.entries !== 'object') {
    throw new Error(`readIndex: invalid shape at ${file}`);
  }
  return parsed;
}

function writeIndex(repoRoot, index) {
  if (!index || typeof index !== 'object' || index.schema_version !== '1.0.0' || typeof index.entries !== 'object') {
    throw new TypeError('writeIndex: invalid index shape');
  }
  const file = indexPath(repoRoot);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(index, null, 2));
  fs.renameSync(tmp, file);
}

function recordBundle(repoRoot, { bundleId, taskIntent, createdAt }) {
  if (!isValidBundleId(bundleId)) {
    throw new TypeError(`recordBundle: invalid bundle id "${bundleId}"`);
  }
  if (typeof taskIntent !== 'string' || taskIntent.length === 0) {
    throw new TypeError('recordBundle: taskIntent must be a non-empty string');
  }
  if (typeof createdAt !== 'string' || !/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(createdAt)) {
    throw new TypeError('recordBundle: createdAt must be ISO 8601');
  }
  const index = readIndex(repoRoot);
  index.entries[bundleId] = {
    task_intent: taskIntent,
    created_at: createdAt,
  };
  writeIndex(repoRoot, index);
  return index;
}

function lookupByIntent(repoRoot, taskIntent) {
  const index = readIndex(repoRoot);
  const matches = [];
  for (const [bundleId, entry] of Object.entries(index.entries)) {
    if (entry.task_intent === taskIntent) {
      matches.push({ bundle_id: bundleId, ...entry });
    }
  }
  return matches;
}

module.exports = {
  readIndex,
  writeIndex,
  recordBundle,
  lookupByIntent,
};
