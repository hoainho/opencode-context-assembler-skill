'use strict';

function extractText(item) {
  const p = item.payload || {};
  if (typeof p === 'string') return p;
  const parts = [];
  if (p.summary) parts.push(`SUMMARY: ${p.summary}`);
  if (p.description) {
    if (typeof p.description === 'string') {
      parts.push(`DESCRIPTION: ${p.description}`);
    } else if (p.description && typeof p.description === 'object' && p.description.text) {
      parts.push(`DESCRIPTION: ${p.description.text}`);
    }
  }
  if (p.body) {
    if (typeof p.body === 'string') {
      parts.push(p.body);
    } else if (p.body && p.body.text) {
      parts.push(p.body.text);
    }
  }
  if (p.author && p.author.displayName) parts.push(`AUTHOR: ${p.author.displayName}`);
  if (p.status && p.status.name) parts.push(`STATUS: ${p.status.name}`);
  if (p.priority && p.priority.name) parts.push(`PRIORITY: ${p.priority.name}`);
  if (p.assignee && p.assignee.displayName) parts.push(`ASSIGNEE: ${p.assignee.displayName}`);
  return parts.length > 0 ? parts.join('\n') : JSON.stringify(p);
}

function buildName(item) {
  const p = item.payload || {};
  if (item.uri.includes('/comment/')) {
    return `Comment on ${item.parent_ticket}`;
  }
  if (item.uri.includes('/link/')) {
    return `Link from ${item.parent_ticket}: ${p.type || 'related'}`;
  }
  return p.key || item.source_ref || 'Jira item';
}

function buildTitle(item) {
  const p = item.payload || {};
  if (p.summary) return p.summary;
  if (item.uri.includes('/comment/')) return `Comment by ${(p.author && p.author.displayName) || 'unknown'}`;
  if (item.uri.includes('/link/')) return `${p.type || 'related'} link`;
  return null;
}

function scoreRelevance(item, task) {
  const text = (task.raw_text || task.task_intent || '').toLowerCase();
  const tickets = (task.references || []).filter((r) => r.kind === 'ticket').map((r) => r.value);
  if (tickets.some((t) => item.source_ref && item.source_ref.startsWith(t))) {
    return { score: 0.95, reason: 'exact-ticket-match' };
  }
  if (item.evidence_quality === 'degraded') {
    return { score: 0.5, reason: 'fallback-search-result' };
  }
  if (text.length > 0 && extractText(item).toLowerCase().includes(text.split(/\s+/)[0])) {
    return { score: 0.6, reason: 'keyword-overlap' };
  }
  return { score: 0.4, reason: 'related-context' };
}

function normalize(rawList, task = {}) {
  if (!Array.isArray(rawList)) {
    throw new TypeError('jira.normalize: rawList must be an array');
  }
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
      annotations: p.updated
        ? { lastModified: p.updated, priority: score }
        : { priority: score },
      content: extractText(item),
      source: 'jira',
      source_ref: item.source_ref,
      fetched_at: new Date().toISOString(),
      fetched_by: task.created_by || 'context-assembler',
      approved: false,
      relevance_score: score,
      relevance_reason: reason,
      evidence_quality: item.evidence_quality,
      evidence_quality_reason: item.evidence_quality_reason,
      mcp_used: item.mcp_used,
      query_issued: item.query_issued,
      extensions: item.parent_ticket ? { parent_ticket: item.parent_ticket } : {},
    });
  }
  return out;
}

module.exports = { normalize, extractText, buildName, scoreRelevance };
