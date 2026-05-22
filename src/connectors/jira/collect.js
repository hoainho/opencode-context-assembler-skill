'use strict';

const { canonicalJSON } = require('../../audit/hash');

const PRIMARY_MCP = 'jira_jira_issues';
const COMMENTS_MCP = 'jira_jira_comments';
const LINKS_MCP = 'jira_jira_links';
const FALLBACK_MCP = 'jira_jira_search';

async function collect(task, { mcpClient }) {
  if (!task || typeof task !== 'object') {
    throw new TypeError('jira.collect: task must be an object');
  }
  if (!mcpClient || typeof mcpClient.call !== 'function') {
    throw new TypeError('jira.collect: mcpClient.call must be a function');
  }

  const tickets = (task.references || []).filter((r) => r && r.kind === 'ticket').map((r) => r.value);
  const raw = [];
  const gaps = [];

  for (const ticketId of tickets) {
    let primaryHit = null;
    try {
      const issueArgs = { action: 'get', issueKey: ticketId };
      const issue = await mcpClient.call(PRIMARY_MCP, issueArgs);
      if (issue && issue.key) {
        primaryHit = {
          uri: `jira://${ticketId}`,
          source_ref: ticketId,
          mcp_used: PRIMARY_MCP,
          query_issued: canonicalJSON(issueArgs),
          evidence_quality: 'verified',
          evidence_quality_reason: 'primary-mcp-call',
          payload: issue,
        };
        raw.push(primaryHit);
      }
    } catch (err) {
      gaps.push({ expected: ticketId, reason: `jira_jira_issues unavailable: ${err.message}` });
      continue;
    }

    if (!primaryHit) {
      const project = ticketId.split('-')[0];
      const keywords = (task.raw_text || task.task_intent || '').replace(/[^\w\s-]/g, ' ').trim();
      const fallbackArgs = {
        action: 'search',
        jql: `project = ${project} AND text ~ "${keywords}"`,
      };
      try {
        const search = await mcpClient.call(FALLBACK_MCP, fallbackArgs);
        if (search && Array.isArray(search.issues) && search.issues.length > 0) {
          for (const hit of search.issues) {
            raw.push({
              uri: `jira://${hit.key}`,
              source_ref: hit.key,
              mcp_used: FALLBACK_MCP,
              query_issued: canonicalJSON(fallbackArgs),
              evidence_quality: 'degraded',
              evidence_quality_reason: 'fallback-search',
              payload: hit,
            });
          }
        } else {
          gaps.push({ expected: ticketId, reason: 'no Jira ticket found via direct get or text search' });
        }
      } catch (err) {
        gaps.push({ expected: ticketId, reason: `jira_jira_search unavailable: ${err.message}` });
      }
      continue;
    }

    try {
      const commentsArgs = { action: 'get', issueKey: ticketId };
      const comments = await mcpClient.call(COMMENTS_MCP, commentsArgs);
      if (comments && Array.isArray(comments.comments)) {
        for (const c of comments.comments) {
          raw.push({
            uri: `jira://${ticketId}/comment/${c.id || 'unknown'}`,
            source_ref: `${ticketId}#${c.id || 'unknown'}`,
            mcp_used: COMMENTS_MCP,
            query_issued: canonicalJSON(commentsArgs),
            evidence_quality: 'verified',
            evidence_quality_reason: 'primary-mcp-call',
            payload: c,
            parent_ticket: ticketId,
          });
        }
      }
    } catch (err) {
      gaps.push({ expected: `${ticketId} comments`, reason: `jira_jira_comments unavailable: ${err.message}` });
    }

    try {
      const linksArgs = { action: 'list', issueKey: ticketId };
      const links = await mcpClient.call(LINKS_MCP, linksArgs);
      if (links && Array.isArray(links.links)) {
        for (const l of links.links) {
          raw.push({
            uri: `jira://${ticketId}/link/${l.id || 'unknown'}`,
            source_ref: `${ticketId}-link-${l.id || 'unknown'}`,
            mcp_used: LINKS_MCP,
            query_issued: canonicalJSON(linksArgs),
            evidence_quality: 'verified',
            evidence_quality_reason: 'primary-mcp-call',
            payload: l,
            parent_ticket: ticketId,
          });
        }
      }
    } catch (err) {
      gaps.push({ expected: `${ticketId} links`, reason: `jira_jira_links unavailable: ${err.message}` });
    }
  }

  return { raw, gaps };
}

module.exports = { collect, PRIMARY_MCP, COMMENTS_MCP, LINKS_MCP, FALLBACK_MCP };
