'use strict';

const { appendEntry } = require('../audit/writer');
const { sha256, canonicalJSON } = require('../audit/hash');

function nowIso() {
  return new Date().toISOString();
}

function withAudit({ repoRoot, bundleId, phase, actor }) {
  if (typeof repoRoot !== 'string') throw new TypeError('withAudit: repoRoot required');
  if (typeof bundleId !== 'string') throw new TypeError('withAudit: bundleId required');
  if (typeof phase !== 'string') throw new TypeError('withAudit: phase required');
  const actorName = actor || 'context-assembler';

  return async function audited({ action, args, exec, ts }) {
    const start = Date.now();
    const t0 = typeof ts === 'string' ? ts : nowIso();
    let resultBody;
    let error;
    try {
      resultBody = await exec();
    } catch (err) {
      error = err;
      resultBody = { _error: err.message };
    }
    const duration_ms = Date.now() - start;
    const entry = {
      ts: t0,
      actor: actorName,
      phase,
      action,
      args: args || {},
      result_hash: sha256(resultBody),
      duration_ms,
    };
    appendEntry({ repoRoot, bundleId, entry, resultBody });
    if (error) throw error;
    return resultBody;
  };
}

module.exports = {
  withAudit,
  nowIso,
};
