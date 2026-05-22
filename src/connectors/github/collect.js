'use strict';

const { canonicalJSON } = require('../../audit/hash');
const { parsePrRef } = require('./match');

const PRIMARY_MCP = 'github_get_pull_request';
const FILES_MCP = 'github_get_pull_request_files';
const REVIEWS_MCP = 'github_get_pull_request_reviews';
const FALLBACK_MCP = 'github_search_code';

function resolveOwnerRepo(prRef, task) {
  if (prRef.owner && prRef.repo) return { owner: prRef.owner, repo: prRef.repo };
  if (task && task.repo_context) {
    return {
      owner: task.repo_context.owner || null,
      repo: task.repo_context.repo || null,
    };
  }
  return { owner: null, repo: null };
}

async function collect(task, { mcpClient }) {
  if (!task || typeof task !== 'object') {
    throw new TypeError('github.collect: task must be an object');
  }
  if (!mcpClient || typeof mcpClient.call !== 'function') {
    throw new TypeError('github.collect: mcpClient.call must be a function');
  }

  const prRefs = (task.references || []).map(parsePrRef).filter(Boolean);
  const raw = [];
  const gaps = [];

  for (const prRef of prRefs) {
    const { owner, repo } = resolveOwnerRepo(prRef, task);
    if (!owner || !repo) {
      gaps.push({
        expected: `PR #${prRef.number}`,
        reason: 'owner/repo not resolvable (task missing repo_context); cannot call github MCP',
      });
      continue;
    }

    let prHit = null;
    const prArgs = { owner, repo, pull_number: prRef.number };
    try {
      const pr = await mcpClient.call(PRIMARY_MCP, prArgs);
      if (pr && pr.number) {
        prHit = pr;
        raw.push({
          uri: `github://${owner}/${repo}/pull/${prRef.number}`,
          source_ref: `${owner}/${repo}#${prRef.number}`,
          mcp_used: PRIMARY_MCP,
          query_issued: canonicalJSON(prArgs),
          evidence_quality: 'verified',
          evidence_quality_reason: 'primary-mcp-call',
          payload: pr,
        });
      }
    } catch (err) {
      gaps.push({
        expected: `${owner}/${repo}#${prRef.number}`,
        reason: `${PRIMARY_MCP} unavailable: ${err.message}`,
      });
      continue;
    }

    if (!prHit) {
      const sanitizedKeywords = String(task.raw_text || '').replace(/[^\w\s-]/g, ' ').trim();
      const fallbackArgs = {
        q: `${sanitizedKeywords} in:file repo:${owner}/${repo}`,
        per_page: 10,
        page: 1,
      };
      try {
        const search = await mcpClient.call(FALLBACK_MCP, fallbackArgs);
        if (search && Array.isArray(search.items) && search.items.length > 0) {
          for (const hit of search.items) {
            if (!hit || !hit.path) continue;
            raw.push({
              uri: `github://${owner}/${repo}/code/${encodeURIComponent(hit.path)}`,
              source_ref: `${owner}/${repo}:${hit.path}`,
              mcp_used: FALLBACK_MCP,
              query_issued: canonicalJSON(fallbackArgs),
              evidence_quality: 'degraded',
              evidence_quality_reason: 'fallback-search',
              payload: hit,
            });
          }
        } else {
          gaps.push({
            expected: `${owner}/${repo}#${prRef.number}`,
            reason: 'no GitHub PR or code search hits',
          });
        }
      } catch (err) {
        gaps.push({
          expected: `${owner}/${repo}#${prRef.number}`,
          reason: `${FALLBACK_MCP} unavailable: ${err.message}`,
        });
      }
      continue;
    }

    try {
      const filesArgs = { owner, repo, pull_number: prRef.number };
      const files = await mcpClient.call(FILES_MCP, filesArgs);
      if (files && Array.isArray(files.files)) {
        for (const f of files.files) {
          raw.push({
            uri: `github://${owner}/${repo}/pull/${prRef.number}/file/${encodeURIComponent(f.filename || 'unknown')}`,
            source_ref: `${owner}/${repo}#${prRef.number}:${f.filename || 'unknown'}`,
            mcp_used: FILES_MCP,
            query_issued: canonicalJSON(filesArgs),
            evidence_quality: 'verified',
            evidence_quality_reason: 'primary-mcp-call',
            payload: f,
            parent_pr: prRef.number,
          });
        }
      }
    } catch (err) {
      gaps.push({
        expected: `${owner}/${repo}#${prRef.number} files`,
        reason: `${FILES_MCP} unavailable: ${err.message}`,
      });
    }

    try {
      const reviewsArgs = { owner, repo, pull_number: prRef.number };
      const reviews = await mcpClient.call(REVIEWS_MCP, reviewsArgs);
      if (reviews && Array.isArray(reviews.reviews)) {
        for (const r of reviews.reviews) {
          raw.push({
            uri: `github://${owner}/${repo}/pull/${prRef.number}/review/${r.id || 'unknown'}`,
            source_ref: `${owner}/${repo}#${prRef.number}-review-${r.id || 'unknown'}`,
            mcp_used: REVIEWS_MCP,
            query_issued: canonicalJSON(reviewsArgs),
            evidence_quality: 'verified',
            evidence_quality_reason: 'primary-mcp-call',
            payload: r,
            parent_pr: prRef.number,
          });
        }
      }
    } catch (err) {
      gaps.push({
        expected: `${owner}/${repo}#${prRef.number} reviews`,
        reason: `${REVIEWS_MCP} unavailable: ${err.message}`,
      });
    }
  }

  return { raw, gaps };
}

module.exports = { collect, PRIMARY_MCP, FILES_MCP, REVIEWS_MCP, FALLBACK_MCP };
