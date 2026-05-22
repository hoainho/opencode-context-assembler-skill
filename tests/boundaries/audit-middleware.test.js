'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const { withAudit, nowIso } = require('../../src/boundaries/audit-middleware');
const { readEntries } = require('../../src/audit/writer');
const { sha256, canonicalJSON } = require('../../src/audit/hash');

const VALID_ID = '01JVK2D9N3R5W7XY8Z2A4B6C8E';

function tempRepo() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cba-mw-'));
}

test('nowIso returns valid ISO 8601 timestamp', () => {
  const ts = nowIso();
  assert.match(ts, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
});

test('withAudit returns an async function', () => {
  const repo = tempRepo();
  const audited = withAudit({ repoRoot: repo, bundleId: VALID_ID, phase: '2', actor: 'test' });
  assert.strictEqual(typeof audited, 'function');
});

test('withAudit rejects missing repoRoot/bundleId/phase', () => {
  assert.throws(() => withAudit({ bundleId: VALID_ID, phase: '2' }), /repoRoot required/);
  assert.throws(() => withAudit({ repoRoot: '/tmp', phase: '2' }), /bundleId required/);
  assert.throws(() => withAudit({ repoRoot: '/tmp', bundleId: VALID_ID }), /phase required/);
});

test('withAudit wraps exec, writes audit entry with sha256 of result, returns body', async () => {
  const repo = tempRepo();
  const audited = withAudit({ repoRoot: repo, bundleId: VALID_ID, phase: '2' });
  const body = { ok: true, items: [1, 2, 3] };
  const ts = '2026-05-22T08:14:00Z';
  const result = await audited({
    action: 'mcp.call',
    args: { tool: 'jira_jira_issues', params: { action: 'get', issueKey: 'WIN-1' } },
    exec: async () => body,
    ts,
  });
  assert.deepStrictEqual(result, body);

  const entries = readEntries({ repoRoot: repo, bundleId: VALID_ID, dateIso: '2026-05-22' });
  assert.strictEqual(entries.length, 1);
  assert.strictEqual(entries[0].action, 'mcp.call');
  assert.strictEqual(entries[0].phase, '2');
  assert.strictEqual(entries[0].actor, 'context-assembler');
  assert.strictEqual(entries[0].result_hash, sha256(canonicalJSON(body)));
  assert.ok(entries[0].duration_ms >= 0);
});

test('withAudit logs failed exec then re-throws (error not swallowed)', async () => {
  const repo = tempRepo();
  const audited = withAudit({ repoRoot: repo, bundleId: VALID_ID, phase: '2' });
  await assert.rejects(
    audited({
      action: 'bash.exec',
      args: { cmd: 'fail' },
      exec: async () => {
        throw new Error('boom');
      },
      ts: '2026-05-22T08:14:00Z',
    }),
    /boom/
  );
  const entries = readEntries({ repoRoot: repo, bundleId: VALID_ID, dateIso: '2026-05-22' });
  assert.strictEqual(entries.length, 1, 'error must still produce audit entry');
  assert.strictEqual(entries[0].action, 'bash.exec');
});

test('withAudit accepts custom actor', async () => {
  const repo = tempRepo();
  const audited = withAudit({ repoRoot: repo, bundleId: VALID_ID, phase: '1', actor: 'discover-phase' });
  await audited({
    action: 'phase.transition',
    args: { from: '0', to: '1' },
    exec: async () => ({ transitioned: true }),
    ts: '2026-05-22T08:00:00Z',
  });
  const entries = readEntries({ repoRoot: repo, bundleId: VALID_ID, dateIso: '2026-05-22' });
  assert.strictEqual(entries[0].actor, 'discover-phase');
});

test('withAudit duration_ms is measured', async () => {
  const repo = tempRepo();
  const audited = withAudit({ repoRoot: repo, bundleId: VALID_ID, phase: '2' });
  await audited({
    action: 'mcp.call',
    args: { tool: 'x' },
    exec: async () => {
      await new Promise((r) => setTimeout(r, 20));
      return { ok: true };
    },
    ts: '2026-05-22T08:00:00Z',
  });
  const entries = readEntries({ repoRoot: repo, bundleId: VALID_ID, dateIso: '2026-05-22' });
  assert.ok(entries[0].duration_ms >= 15, `duration_ms ${entries[0].duration_ms} must be >=15ms`);
});

test('withAudit handles 5 sequential calls (append-only ordering preserved)', async () => {
  const repo = tempRepo();
  const audited = withAudit({ repoRoot: repo, bundleId: VALID_ID, phase: '2' });
  for (let i = 0; i < 5; i++) {
    await audited({
      action: 'mcp.call',
      args: { i },
      exec: async () => ({ idx: i }),
      ts: `2026-05-22T08:0${i}:00Z`,
    });
  }
  const entries = readEntries({ repoRoot: repo, bundleId: VALID_ID, dateIso: '2026-05-22' });
  assert.strictEqual(entries.length, 5);
  for (let i = 0; i < 5; i++) {
    assert.strictEqual(entries[i].args.i, i, `entry ${i} order preserved`);
  }
});
