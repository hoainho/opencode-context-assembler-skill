'use strict';

const { parseIntent } = require('../intent/parser');

function buildTaskIntent({ text, createdBy, createdAt, bundleId }) {
  if (typeof text !== 'string') {
    throw new TypeError('buildTaskIntent: text must be a string');
  }
  if (typeof createdBy !== 'string' || createdBy.length === 0) {
    throw new TypeError('buildTaskIntent: createdBy must be non-empty string');
  }
  if (typeof createdAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(createdAt)) {
    throw new TypeError('buildTaskIntent: createdAt must be ISO 8601');
  }
  if (typeof bundleId !== 'string' || bundleId.length === 0) {
    throw new TypeError('buildTaskIntent: bundleId must be non-empty string');
  }

  const parsed = parseIntent(text);

  return {
    schema_version: '1.0.0',
    bundle_id: bundleId,
    created_by: createdBy,
    created_at: createdAt,
    raw_text: parsed.raw,
    empty: parsed.empty,
    task_type: parsed.task_type,
    verb: parsed.verb,
    references: parsed.references,
    scope_window: parsed.scope_window,
    confident: parsed.confident,
    classifier_scores: parsed.classifier_scores || null,
    fallback_questions: parsed.fallback_questions,
  };
}

module.exports = {
  buildTaskIntent,
};
