'use strict';

function extractText(item) {
  const p = item.payload || {};
  if (typeof p === 'string') return p;
  const parts = [];
  if (p.title) parts.push(`TITLE: ${p.title}`);
  if (p.body) parts.push(`BODY: ${typeof p.body === 'string' ? p.body : JSON.stringify(p.body)}`);
  if (p.user && p.user.login) parts.push(`AUTHOR: ${p.user.login}`);
  if (p.state) parts.push(`STATE: ${p.state}`);
  if (p.filename) parts.push(`FILE: ${p.filename}`);
  if (typeof p.additions === 'number' && typeof p.deletions === 'number') {
    parts.push(`DIFF: +${p.additions}/-${p.deletions} lines`);
  }
  if (p.patch) parts.push(`PATCH:\n${String(p.patch).slice(0, 2000)}`);
  if (p.state === 'APPROVED' || p.state === 'CHANGES_REQUESTED' || p.state === 'COMMENTED') {
    if (p.body) parts.push(`REVIEW BODY: ${p.body}`);
  }
  return parts.length > 0 ? parts.join('\n') : JSON.stringify(p);
}

function buildName(item) {
  const p = item.payload || {};
  if (item.uri.includes('/file/')) {
    return `Changed file: ${p.filename || 'unknown'}`;
  }
  if (item.uri.includes('/review/')) {
    return `Review by ${(p.user && p.user.login) || 'unknown'} on PR #${item.parent_pr}`;
  }
  if (item.uri.includes('/code/')) {
    return `Code match: ${p.path || 'unknown'}`;
  }
  return p.title || item.source_ref || 'GitHub item';
}

function buildTitle(item) {
  const p = item.payload || {};
  if (p.title) return p.title;
  if (item.uri.includes('/file/')) return p.filename || null;
  if (item.uri.includes('/review/')) return `${p.state || 'review'} review`;
  return null;
}

function scoreRelevance(item, task) {
  if (item.uri.match(/\/pull\/\d+$/)) {
    return { score: 0.95, reason: 'exact-pr-reference' };
  }
  if (item.uri.includes('/file/') || item.uri.includes('/review/')) {
    return { score: 0.75, reason: 'pr-child-artifact' };
  }
  if (item.evidence_quality === 'degraded') {
    return { score: 0.5, reason: 'fallback-search-result' };
  }
  return { score: 0.4, reason: 'related-context' };
}

function normalize(rawList, task = {}) {
  if (!Array.isArray(rawList)) {
    throw new TypeError('github.normalize: rawList must be an array');
  }
  const fetchedAt = new Date().toISOString();
  const out = [];
  for (const item of rawList) {
    if (!item || typeof item !== 'object' || !item.uri) continue;
    const { score, reason } = scoreRelevance(item, task);
    const p = item.payload || {};
    out.push({
      uri: item.uri,
      name: buildName(item),
      title: buildTitle(item),
      mimeType: 'text/markdown',
      annotations: p.updated_at ? { lastModified: p.updated_at, priority: score } : { priority: score },
      content: extractText(item),
      source: 'github',
      source_ref: item.source_ref,
      fetched_at: fetchedAt,
      fetched_by: task.created_by || 'context-assembler',
      approved: false,
      relevance_score: score,
      relevance_reason: reason,
      evidence_quality: item.evidence_quality,
      evidence_quality_reason: item.evidence_quality_reason,
      mcp_used: item.mcp_used,
      query_issued: item.query_issued,
      extensions: item.parent_pr ? { parent_pr: item.parent_pr } : {},
    });
  }
  return out;
}

module.exports = { normalize, extractText, buildName, scoreRelevance };
