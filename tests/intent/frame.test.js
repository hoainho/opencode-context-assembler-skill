'use strict';

const assert = require('assert');
const test = require('node:test');
const { buildTaskIntent } = require('../../src/phases/frame');

const VALID_BASE = {
  text: 'fix WIN-7993 daily bonus auto-claim stuck',
  createdBy: 'nhoxtvt@gmail.com',
  createdAt: '2026-05-22T08:14:00Z',
  bundleId: '01JVK2D9N3R5W7XY8Z2A4B6C8E',
};

test('buildTaskIntent emits schema-shaped envelope with parsed intent fields', () => {
  const intent = buildTaskIntent(VALID_BASE);
  assert.strictEqual(intent.schema_version, '1.0.0');
  assert.strictEqual(intent.bundle_id, VALID_BASE.bundleId);
  assert.strictEqual(intent.created_by, VALID_BASE.createdBy);
  assert.strictEqual(intent.created_at, VALID_BASE.createdAt);
  assert.strictEqual(intent.task_type, 'bug-fix');
  assert.strictEqual(intent.verb, 'fix');
  assert.strictEqual(intent.references[0].value, 'WIN-7993');
  assert.strictEqual(intent.confident, true);
  assert.strictEqual(intent.fallback_questions, null);
});

test('buildTaskIntent on empty text emits empty=true + fallback_questions', () => {
  const intent = buildTaskIntent({ ...VALID_BASE, text: '' });
  assert.strictEqual(intent.empty, true);
  assert.strictEqual(intent.task_type, null);
  assert.strictEqual(intent.fallback_questions.length, 3);
});

test('buildTaskIntent rejects bad text/creator/timestamp/bundleId', () => {
  assert.throws(() => buildTaskIntent({ ...VALID_BASE, text: 123 }), /text must be a string/);
  assert.throws(() => buildTaskIntent({ ...VALID_BASE, createdBy: '' }), /createdBy/);
  assert.throws(() => buildTaskIntent({ ...VALID_BASE, createdAt: 'not-iso' }), /ISO 8601/);
  assert.throws(() => buildTaskIntent({ ...VALID_BASE, bundleId: '' }), /bundleId/);
});
