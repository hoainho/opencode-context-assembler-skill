'use strict';

const APPLICABLE_TASK_TYPES = new Set(['bug-fix', 'feature', 'review']);

const GITHUB_URL_RE = /^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/(?:pull|issues)\/(\d+)/;

function parsePrRef(ref) {
  if (!ref || typeof ref !== 'object') return null;
  if (ref.kind === 'pr') {
    return { number: ref.number, owner: ref.owner || null, repo: ref.repo || null };
  }
  if (ref.kind === 'url' && typeof ref.value === 'string') {
    const m = ref.value.match(GITHUB_URL_RE);
    if (m) return { owner: m[1], repo: m[2], number: Number(m[3]) };
  }
  return null;
}

function match(task) {
  if (!task || typeof task !== 'object') return false;
  if (!APPLICABLE_TASK_TYPES.has(task.task_type)) return false;
  if (!Array.isArray(task.references)) return false;
  return task.references.some((ref) => parsePrRef(ref) !== null);
}

module.exports = { match, parsePrRef, APPLICABLE_TASK_TYPES, GITHUB_URL_RE };
