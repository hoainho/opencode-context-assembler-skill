'use strict';

const path = require('path');

const READ_ONLY_TOOLS = new Set([
  'jira_jira_search',
  'jira_jira_issues:get',
  'jira_jira_comments:get',
  'jira_jira_links:list',
  'jira_jira_links:get_link_types',
  'jira_jira_attachments:list',
  'jira_jira_attachments:get_content',
  'confluence_conf_get',
  'github_get_pull_request',
  'github_get_pull_request_files',
  'github_get_pull_request_reviews',
  'github_get_pull_request_comments',
  'github_get_pull_request_status',
  'github_get_issue',
  'github_get_file_contents',
  'github_list_pull_requests',
  'github_list_issues',
  'github_list_commits',
  'github_search_code',
  'github_search_issues',
  'github_search_users',
  'github_search_repositories',
  'google-drive_gdrive_search',
  'google-drive_gdrive_read_file',
  'google-drive_gsheets_read',
  'omo-session-distiller_recall',
  'omo-session-distiller_expand',
  'omo-session-distiller_stats',
]);

const WRITE_SURFACE_TOOLS = new Set([
  'jira_jira_issues:create',
  'jira_jira_issues:update',
  'jira_jira_issues:assign',
  'jira_jira_comments:add',
  'jira_jira_links:add',
  'jira_jira_links:remove',
  'jira_jira_attachments:upload',
  'jira_jira_attachments:delete',
  'jira_jira_workflow:transition',
  'confluence_conf_post',
  'confluence_conf_put',
  'confluence_conf_patch',
  'confluence_conf_delete',
  'google-drive_gsheets_update_cell',
  'github_create_pull_request',
  'github_create_pull_request_review',
  'github_merge_pull_request',
  'github_update_pull_request_branch',
  'github_create_issue',
  'github_update_issue',
  'github_add_issue_comment',
  'github_create_branch',
  'github_create_or_update_file',
  'github_push_files',
  'github_create_repository',
  'github_fork_repository',
  'slack_post_message',
  'slack_send_dm',
]);

const APPROVAL_TOKEN = 'APPROVE SEND';

function classifyTool(toolKey) {
  if (typeof toolKey !== 'string' || toolKey.length === 0) {
    throw new TypeError('classifyTool: toolKey must be non-empty string');
  }
  if (WRITE_SURFACE_TOOLS.has(toolKey)) return 'write-surface';
  if (READ_ONLY_TOOLS.has(toolKey)) return 'read-only';
  return 'unclassified';
}

function checkApproval({ toolKey, payload, approvalInput }) {
  if (typeof toolKey !== 'string' || toolKey.length === 0) {
    throw new TypeError('checkApproval: toolKey must be non-empty string');
  }
  if (payload === undefined || payload === null) {
    throw new TypeError('checkApproval: payload must be provided (the request body)');
  }

  const cls = classifyTool(toolKey);

  if (cls === 'read-only') {
    return { allowed: true, classification: cls };
  }

  if (cls === 'unclassified') {
    return {
      allowed: false,
      classification: cls,
      reason: `BoundaryViolation: tool "${toolKey}" is not in READ_ONLY or WRITE_SURFACE allowlist; default-deny`,
    };
  }

  if (typeof approvalInput !== 'string') {
    return {
      allowed: false,
      classification: cls,
      reason: `BoundaryViolation: write-surface tool "${toolKey}" requires APPROVE SEND prompt (no approval provided)`,
      payload_preview: previewPayload(payload),
    };
  }

  if (approvalInput.trim() !== APPROVAL_TOKEN) {
    return {
      allowed: false,
      classification: cls,
      reason: `BoundaryViolation: approval must be literal "${APPROVAL_TOKEN}", got "${approvalInput.trim().slice(0, 50)}"`,
      payload_preview: previewPayload(payload),
    };
  }

  return {
    allowed: true,
    classification: cls,
    payload_preview: previewPayload(payload),
  };
}

function previewPayload(payload) {
  if (typeof payload === 'string') {
    return payload.length > 200 ? payload.slice(0, 200) + '... [truncated]' : payload;
  }
  const json = JSON.stringify(payload);
  return json.length > 200 ? json.slice(0, 200) + '... [truncated]' : json;
}

module.exports = {
  READ_ONLY_TOOLS,
  WRITE_SURFACE_TOOLS,
  APPROVAL_TOKEN,
  classifyTool,
  checkApproval,
  previewPayload,
};
