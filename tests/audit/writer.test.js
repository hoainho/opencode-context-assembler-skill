'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const { canonicalJSON, sha256 } = require('../../src/audit/hash');
const {
  VALID_ACTIONS,
  VALID_PHASES,
  dateIsoFromTimestamp,
  validateEntry,
  appendEntry,
  readEntries,
} = require('../../src/audit/writer');

const VALID_ID = '01JVK2D9N3R5W7XY8Z2A4B6C8E';

function tempRepo() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cba-audit-'));
}

function entryFor(resultBody, overrides = {}) {
  const body = canonicalJSON(resultBody);
  return {
    ts: '2026-05-22T08:14:03.142Z',
    actor: 'context-assembler',
    phase: '2',
    action: 'mcp.call',
    args: { tool: 'jira_jira_issues', params: { action: 'get', issueKey: 'WIN-7993' } },
    result_hash: sha256(body),
    duration_ms: 412,
    ...overrides,
  };
}

test('VALID_ACTIONS includes mcp.call/bash.exec/file.write/phase.transition/compaction/gap.emit/throttle.event', () => {
  for (const a of ['mcp.call', 'bash.exec', 'file.write', 'phase.transition', 'compaction', 'gap.emit', 'throttle.event']) {
    assert.ok(VALID_ACTIONS.has(a), `${a} must be a valid action`);
  }
});

test('VALID_PHASES matches schema phases.id strings', () => {
  for (const p of ['0', '1', '1.5', '2', '3', '4']) {
    assert.ok(VALID_PHASES.has(p), `${p} must be a valid phase`);
  }
});

test('dateIsoFromTimestamp extracts YYYY-MM-DD', () => {
  assert.strictEqual(dateIsoFromTimestamp('2026-05-22T08:14:00Z'), '2026-05-22');
  assert.strictEqual(dateIsoFromTimestamp('2026-05-22T08:14:03.142Z'), '2026-05-22');
});

test('dateIsoFromTimestamp throws on non-ISO', () => {
  assert.throws(() => dateIsoFromTimestamp('05-22-2026'), /not ISO 8601/);
  assert.throws(() => dateIsoFromTimestamp(null), /must be ISO 8601 string/);
});

test('validateEntry accepts a well-formed entry', () => {
  validateEntry(entryFor({ ok: true }));
});

test('validateEntry rejects missing fields', () => {
  for (const key of ['ts', 'actor', 'phase', 'action', 'args', 'result_hash', 'duration_ms']) {
    const e = entryFor({ ok: true });
    delete e[key];
    assert.throws(() => validateEntry(e), new RegExp(`missing required field "${key}"`));
  }
});

test('validateEntry rejects bad phase / action / hash / duration', () => {
  assert.throws(() => validateEntry(entryFor({}, { phase: '5' })), /phase must be one of/);
  assert.throws(() => validateEntry(entryFor({}, { action: 'unknown' })), /action must be one of/);
  assert.throws(() => validateEntry(entryFor({}, { result_hash: 'TOO-SHORT' })), /result_hash must be 64-char/);
  assert.throws(() => validateEntry(entryFor({}, { result_hash: 'A'.repeat(64) })), /lowercase hex/);
  assert.throws(() => validateEntry(entryFor({}, { duration_ms: -1 })), /non-negative finite/);
  assert.throws(() => validateEntry(entryFor({}, { duration_ms: Infinity })), /non-negative finite/);
});

test('appendEntry writes ndjson + cached result, hash-verified', () => {
  const repo = tempRepo();
  const body = { ok: true, items: [1, 2, 3] };
  const entry = entryFor(body);
  const { ndjsonPath, dateIso } = appendEntry({ repoRoot: repo, bundleId: VALID_ID, entry, resultBody: body });

  assert.ok(fs.existsSync(ndjsonPath), 'ndjson file exists');
  const lines = fs.readFileSync(ndjsonPath, 'utf8').split('\n').filter(Boolean);
  assert.strictEqual(lines.length, 1);
  assert.deepStrictEqual(JSON.parse(lines[0]), entry);

  const resultPath = path.join(repo, '.opencode', 'audit', dateIso, 'results', `${entry.result_hash}.json`);
  assert.ok(fs.existsSync(resultPath), 'cached result body exists');
  assert.strictEqual(sha256(fs.readFileSync(resultPath, 'utf8')), entry.result_hash);
});

test('appendEntry rejects body whose hash mismatches the entry', () => {
  const repo = tempRepo();
  const entry = entryFor({ ok: true });
  assert.throws(
    () => appendEntry({ repoRoot: repo, bundleId: VALID_ID, entry, resultBody: { tampered: true } }),
    /result_hash mismatch/
  );
});

test('appendEntry rejects bad bundleId / non-absolute repoRoot', () => {
  assert.throws(
    () => appendEntry({ repoRoot: tempRepo(), bundleId: 'bad', entry: entryFor({}), resultBody: {} }),
    /invalid bundleId/
  );
  assert.throws(
    () => appendEntry({ repoRoot: 'rel', bundleId: VALID_ID, entry: entryFor({}), resultBody: {} }),
    /must be absolute/
  );
});

test('appendEntry is append-only: 5 entries -> 5 ndjson lines, deterministic order', () => {
  const repo = tempRepo();
  for (let i = 0; i < 5; i++) {
    const body = { idx: i };
    const e = entryFor(body, { ts: `2026-05-22T08:14:0${i}.000Z` });
    appendEntry({ repoRoot: repo, bundleId: VALID_ID, entry: e, resultBody: body });
  }
  const entries = readEntries({ repoRoot: repo, bundleId: VALID_ID, dateIso: '2026-05-22' });
  assert.strictEqual(entries.length, 5);
  for (let i = 0; i < 5; i++) {
    assert.strictEqual(entries[i].args.params.issueKey, 'WIN-7993', 'order preserved');
  }
});

test('appendEntry de-duplicates cached result bodies by hash', () => {
  const repo = tempRepo();
  const body = { shared: true };
  const e1 = entryFor(body, { ts: '2026-05-22T08:00:00Z' });
  const e2 = entryFor(body, { ts: '2026-05-22T08:00:01Z' });
  appendEntry({ repoRoot: repo, bundleId: VALID_ID, entry: e1, resultBody: body });
  appendEntry({ repoRoot: repo, bundleId: VALID_ID, entry: e2, resultBody: body });

  const dir = path.join(repo, '.opencode', 'audit', '2026-05-22', 'results');
  const files = fs.readdirSync(dir);
  assert.strictEqual(files.length, 1, 'duplicate hash should not write twice');
});

test('readEntries throws on corrupt JSON line', () => {
  const repo = tempRepo();
  const dir = path.join(repo, '.opencode', 'audit', '2026-05-22');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${VALID_ID}.ndjson`), 'not json\n');
  assert.throws(
    () => readEntries({ repoRoot: repo, bundleId: VALID_ID, dateIso: '2026-05-22' }),
    /invalid JSON at/
  );
});

test('readEntries returns [] when file missing', () => {
  const repo = tempRepo();
  const entries = readEntries({ repoRoot: repo, bundleId: VALID_ID, dateIso: '2026-05-22' });
  assert.deepStrictEqual(entries, []);
});
