'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const { canonicalJSON, sha256 } = require('../../src/audit/hash');
const { appendEntry } = require('../../src/audit/writer');
const { replayBundle } = require('../../src/audit/replay');
const { bundleDir, bundleLockPath } = require('../../src/storage/bundle-paths');

const VALID_ID = '01JVK2D9N3R5W7XY8Z2A4B6C8E';

function tempRepo() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cba-replay-'));
}

function writeLock(repo, bundleId, hash) {
  const dir = bundleDir(bundleId, repo);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    bundleLockPath(bundleId, repo),
    JSON.stringify({
      schema_version: '1.0.0',
      bundle_id: bundleId,
      approved_at: '2026-05-22T09:00:00Z',
      approved_by: 'tester',
      hash,
      items_hash: [],
      audit_log_ref: `.opencode/audit/2026-05-22/${bundleId}.ndjson`,
      scoring_strategy: 'content-hash-v1',
    })
  );
}

function seedFixture(repo, options = {}) {
  const bundleHash = sha256({ items: [{ uri: 'jira://WIN-1' }] });
  writeLock(repo, VALID_ID, bundleHash);
  for (let i = 0; i < (options.entryCount || 3); i++) {
    const body = { idx: i, payload: 'deterministic' };
    const bodyStr = canonicalJSON(body);
    const entry = {
      ts: `2026-05-22T08:0${i}:00.000Z`,
      actor: 'context-assembler',
      phase: '2',
      action: 'mcp.call',
      args: { tool: 'jira_jira_issues', i },
      result_hash: sha256(bodyStr),
      duration_ms: 100 + i,
    };
    appendEntry({ repoRoot: repo, bundleId: VALID_ID, entry, resultBody: body });
  }
  return { bundleHash };
}

test('replayBundle reads entries + verifies cached body hashes', () => {
  const repo = tempRepo();
  const { bundleHash } = seedFixture(repo);
  const result = replayBundle({ repoRoot: repo, bundleId: VALID_ID, dateIso: '2026-05-22', mode: 'no-fetch' });
  assert.strictEqual(result.verified, true);
  assert.strictEqual(result.entry_count, 3);
  assert.strictEqual(result.bundle_hash, bundleHash);
  assert.match(result.audit_digest, /^[a-f0-9]{64}$/);
});

test('replayBundle is bit-deterministic across 100 invocations', () => {
  const repo = tempRepo();
  seedFixture(repo);
  const first = replayBundle({ repoRoot: repo, bundleId: VALID_ID, dateIso: '2026-05-22', mode: 'no-fetch' });
  for (let i = 0; i < 100; i++) {
    const next = replayBundle({ repoRoot: repo, bundleId: VALID_ID, dateIso: '2026-05-22', mode: 'no-fetch' });
    assert.strictEqual(next.audit_digest, first.audit_digest, `run ${i} digest drift`);
    assert.strictEqual(next.bundle_hash, first.bundle_hash);
    assert.strictEqual(next.entry_count, first.entry_count);
  }
});

test('replayBundle detects cache tamper (body changed after audit)', () => {
  const repo = tempRepo();
  seedFixture(repo);
  const dir = path.join(repo, '.opencode', 'audit', '2026-05-22', 'results');
  const files = fs.readdirSync(dir);
  fs.writeFileSync(path.join(dir, files[0]), 'TAMPERED');
  assert.throws(
    () => replayBundle({ repoRoot: repo, bundleId: VALID_ID, dateIso: '2026-05-22', mode: 'no-fetch' }),
    /hash mismatch/
  );
});

test('replayBundle throws when no audit entries exist', () => {
  const repo = tempRepo();
  assert.throws(
    () => replayBundle({ repoRoot: repo, bundleId: VALID_ID, dateIso: '2026-05-22', mode: 'no-fetch' }),
    /no audit entries/
  );
});

test('replayBundle rejects invalid args', () => {
  assert.throws(
    () => replayBundle({ repoRoot: 'rel', bundleId: VALID_ID, dateIso: '2026-05-22', mode: 'no-fetch' }),
    /must be absolute/
  );
  assert.throws(
    () => replayBundle({ repoRoot: '/tmp', bundleId: 'bad', dateIso: '2026-05-22', mode: 'no-fetch' }),
    /invalid bundleId/
  );
  assert.throws(
    () => replayBundle({ repoRoot: '/tmp', bundleId: VALID_ID, dateIso: 'not-a-date', mode: 'no-fetch' }),
    /YYYY-MM-DD/
  );
  assert.throws(
    () => replayBundle({ repoRoot: '/tmp', bundleId: VALID_ID, dateIso: '2026-05-22', mode: 'bad' }),
    /mode must be/
  );
});

test('replayBundle live mode is explicitly not implemented in v1', () => {
  const repo = tempRepo();
  seedFixture(repo);
  assert.throws(
    () => replayBundle({ repoRoot: repo, bundleId: VALID_ID, dateIso: '2026-05-22', mode: 'live' }),
    /mode=live not implemented in v1/
  );
});

test('replayBundle CLI parses args (smoke-test)', () => {
  const { parseArgs } = require('../../bin/context-assembler-replay');
  const parsed = parseArgs([VALID_ID, '--date', '2026-05-22', '--no-fetch', '--repo', '/tmp/repo']);
  assert.strictEqual(parsed.bundleId, VALID_ID);
  assert.strictEqual(parsed.dateIso, '2026-05-22');
  assert.strictEqual(parsed.mode, 'no-fetch');
  assert.strictEqual(parsed.repoRoot, path.resolve('/tmp/repo'));
});
