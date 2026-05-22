'use strict';

const APPLICABLE_TASK_TYPES = new Set(['bug-fix', 'feature', 'review']);

function match(task) {
  if (!task || typeof task !== 'object') return false;
  if (!APPLICABLE_TASK_TYPES.has(task.task_type)) return false;
  if (!Array.isArray(task.references)) return false;
  return task.references.some((ref) => ref && ref.kind === 'ticket');
}

module.exports = { match, APPLICABLE_TASK_TYPES };
