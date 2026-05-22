'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const { readIndex, writeIndex, recordBundle, lookupByIntent } = require('../../src/storage/bundle-index');

function tempRepo() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cba-storage-'));
}

test('readIndex returns empty index when file does not exist', () => {
  const repo = tempRepo();
  const index = readIndex(repo);
  assert.deepStrictEqual(index, { schema_version: '1.0.0', entries: {} });
});

test('writeIndex round-trips through readIndex atomically (rename)', () => {
  const repo = tempRepo();
  const original = {
    schema_version: '1.0.0',
    entries: {
      '01JVK2D9N3R5W7XY8Z2A4B6C8E': { task_intent: 'fix WIN-1', created_at: '2026-05-22T08:00:00Z' },
    },
  };
  writeIndex(repo, original);
  const back = readIndex(repo);
  assert.deepStrictEqual(back, original);
});

test('writeIndex rejects malformed index shape', () => {
  const repo = tempRepo();
  assert.throws(() => writeIndex(repo, null), /invalid index shape/);
  assert.throws(() => writeIndex(repo, { schema_version: '0.9.0', entries: {} }), /invalid index shape/);
  assert.throws(() => writeIndex(repo, { schema_version: '1.0.0' }), /invalid index shape/);
});

test('readIndex throws on corrupt JSON', () => {
  const repo = tempRepo();
  const file = path.join(repo, '.opencode', 'context-bundles', '.index.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '{ not valid json');
  assert.throws(() => readIndex(repo), /corrupt JSON/);
});

test('recordBundle appends entry and persists across reads', () => {
  const repo = tempRepo();
  recordBundle(repo, {
    bundleId: '01JVK2D9N3R5W7XY8Z2A4B6C8E',
    taskIntent: 'fix WIN-7993',
    createdAt: '2026-05-22T08:14:00Z',
  });
  recordBundle(repo, {
    bundleId: 'RWAVE2XAZJPFTDMNTV44Z98GQP',
    taskIntent: 'implement leaderboard refresh',
    createdAt: '2026-05-22T09:00:00Z',
  });
  const index = readIndex(repo);
  assert.strictEqual(Object.keys(index.entries).length, 2);
  assert.strictEqual(index.entries['01JVK2D9N3R5W7XY8Z2A4B6C8E'].task_intent, 'fix WIN-7993');
});

test('recordBundle rejects invalid bundle id, intent, or timestamp', () => {
  const repo = tempRepo();
  assert.throws(
    () => recordBundle(repo, { bundleId: 'bad-id', taskIntent: 'x', createdAt: '2026-05-22T08:00:00Z' }),
    /invalid bundle id/
  );
  assert.throws(
    () => recordBundle(repo, { bundleId: '01JVK2D9N3R5W7XY8Z2A4B6C8E', taskIntent: '', createdAt: '2026-05-22T08:00:00Z' }),
    /taskIntent/
  );
  assert.throws(
    () => recordBundle(repo, { bundleId: '01JVK2D9N3R5W7XY8Z2A4B6C8E', taskIntent: 'x', createdAt: 'not-iso' }),
    /ISO 8601/
  );
});

test('lookupByIntent returns all matching entries', () => {
  const repo = tempRepo();
  recordBundle(repo, { bundleId: '01JVK2D9N3R5W7XY8Z2A4B6C8E', taskIntent: 'same intent', createdAt: '2026-05-22T08:00:00Z' });
  recordBundle(repo, { bundleId: 'RWAVE2XAZJPFTDMNTV44Z98GQP', taskIntent: 'same intent', createdAt: '2026-05-22T09:00:00Z' });
  recordBundle(repo, { bundleId: 'NBTVVQ0PYAD4F7KJ8Y2T3Q3WVW', taskIntent: 'different', createdAt: '2026-05-22T10:00:00Z' });

  const matches = lookupByIntent(repo, 'same intent');
  assert.strictEqual(matches.length, 2);
  assert.ok(matches.every((m) => m.task_intent === 'same intent'));

  const empty = lookupByIntent(repo, 'no match');
  assert.deepStrictEqual(empty, []);
});
