'use strict';

const assert = require('assert');
const test = require('node:test');
const {
  READ_ONLY_TOOLS,
  WRITE_SURFACE_TOOLS,
  APPROVAL_TOKEN,
  classifyTool,
  checkApproval,
  previewPayload,
} = require('../../src/boundaries/surface-gate');

test('APPROVAL_TOKEN is the literal "APPROVE SEND"', () => {
  assert.strictEqual(APPROVAL_TOKEN, 'APPROVE SEND');
});

test('READ_ONLY_TOOLS covers Jira/Confluence/GitHub/google-drive/atoms reads', () => {
  for (const t of [
    'jira_jira_search',
    'jira_jira_issues:get',
    'confluence_conf_get',
    'github_get_pull_request',
    'github_search_code',
    'google-drive_gdrive_search',
    'google-drive_gsheets_read',
    'omo-session-distiller_recall',
  ]) {
    assert.ok(READ_ONLY_TOOLS.has(t), `${t} must be read-only`);
  }
});

test('WRITE_SURFACE_TOOLS covers all write actions across providers', () => {
  for (const t of [
    'jira_jira_comments:add',
    'jira_jira_issues:create',
    'jira_jira_workflow:transition',
    'confluence_conf_post',
    'github_create_pull_request',
    'github_merge_pull_request',
    'slack_post_message',
    'google-drive_gsheets_update_cell',
  ]) {
    assert.ok(WRITE_SURFACE_TOOLS.has(t), `${t} must be write-surface`);
  }
});

test('classifyTool returns read-only / write-surface / unclassified', () => {
  assert.strictEqual(classifyTool('github_get_pull_request'), 'read-only');
  assert.strictEqual(classifyTool('github_create_pull_request'), 'write-surface');
  assert.strictEqual(classifyTool('totally_unknown_tool'), 'unclassified');
});

test('classifyTool rejects empty/non-string', () => {
  assert.throws(() => classifyTool(''), /non-empty string/);
  assert.throws(() => classifyTool(null), /non-empty string/);
});

test('checkApproval ALLOWS read-only tools without approval', () => {
  const result = checkApproval({ toolKey: 'jira_jira_search', payload: { jql: 'project=WIN' } });
  assert.strictEqual(result.allowed, true);
  assert.strictEqual(result.classification, 'read-only');
});

test('checkApproval DEFAULT-DENIES unclassified tools', () => {
  const result = checkApproval({ toolKey: 'mysterious_tool', payload: { x: 1 } });
  assert.strictEqual(result.allowed, false);
  assert.strictEqual(result.classification, 'unclassified');
  assert.match(result.reason, /default-deny/);
});

test('checkApproval REJECTS write-surface tool without approval', () => {
  const result = checkApproval({
    toolKey: 'jira_jira_comments:add',
    payload: { issueKey: 'WIN-1', comment: 'hi' },
  });
  assert.strictEqual(result.allowed, false);
  assert.match(result.reason, /requires APPROVE SEND/);
  assert.match(result.payload_preview, /WIN-1/);
});

test('checkApproval REJECTS write-surface with wrong approval string', () => {
  const result = checkApproval({
    toolKey: 'github_create_pull_request',
    payload: { title: 'hi' },
    approvalInput: 'yes please',
  });
  assert.strictEqual(result.allowed, false);
  assert.match(result.reason, /must be literal "APPROVE SEND"/);
});

test('checkApproval ALLOWS write-surface with exact APPROVE SEND', () => {
  const result = checkApproval({
    toolKey: 'github_create_pull_request',
    payload: { title: 'hi' },
    approvalInput: 'APPROVE SEND',
  });
  assert.strictEqual(result.allowed, true);
  assert.strictEqual(result.classification, 'write-surface');
});

test('checkApproval ALLOWS APPROVE SEND with leading/trailing whitespace', () => {
  const result = checkApproval({
    toolKey: 'slack_post_message',
    payload: { channel: '#general', text: 'hi' },
    approvalInput: '  APPROVE SEND\n',
  });
  assert.strictEqual(result.allowed, true);
});

test('checkApproval payload_preview truncates >200 chars', () => {
  const big = { data: 'x'.repeat(500) };
  const result = checkApproval({
    toolKey: 'github_create_pull_request',
    payload: big,
    approvalInput: 'APPROVE SEND',
  });
  assert.ok(result.payload_preview.length <= 220);
  assert.ok(result.payload_preview.endsWith('... [truncated]'));
});

test('previewPayload handles strings vs objects', () => {
  assert.strictEqual(previewPayload('short'), 'short');
  assert.match(previewPayload('x'.repeat(500)), /\.\.\. \[truncated\]/);
  assert.match(previewPayload({ a: 1 }), /"a":1/);
});

test('checkApproval requires payload', () => {
  assert.throws(
    () => checkApproval({ toolKey: 'jira_jira_search' }),
    /payload must be provided/
  );
});

const ATTACK_TOOLS = [
  { toolKey: 'jira_jira_comments:add', payload: { issue: 'WIN-1', comment: 'leak' } },
  { toolKey: 'jira_jira_issues:create', payload: { summary: 'auto' } },
  { toolKey: 'jira_jira_issues:update', payload: { issueKey: 'WIN-1', summary: 'X' } },
  { toolKey: 'jira_jira_workflow:transition', payload: { issueKey: 'WIN-1', transitionId: '1' } },
  { toolKey: 'confluence_conf_post', payload: { title: 'auto' } },
  { toolKey: 'confluence_conf_delete', payload: { path: '/wiki/api/v2/pages/1' } },
  { toolKey: 'github_create_pull_request', payload: { title: 'auto', head: 'x', base: 'main' } },
  { toolKey: 'github_merge_pull_request', payload: { owner: 'h', repo: 'r', pull_number: 1 } },
  { toolKey: 'github_create_issue', payload: { title: 'leak' } },
  { toolKey: 'github_add_issue_comment', payload: { issue_number: 1, body: 'leak' } },
  { toolKey: 'github_push_files', payload: { files: [] } },
  { toolKey: 'slack_post_message', payload: { channel: '#urgent', text: 'auto' } },
  { toolKey: 'google-drive_gsheets_update_cell', payload: { fileId: 'X', range: 'A1', value: 'X' } },
];

test('13 write-surface tools all REJECTED without APPROVE SEND', () => {
  for (const { toolKey, payload } of ATTACK_TOOLS) {
    const result = checkApproval({ toolKey, payload });
    assert.strictEqual(result.allowed, false, `must reject without approval: ${toolKey}`);
  }
});

test('Batched approval impossible: each call requires its own APPROVE SEND', () => {
  for (const { toolKey, payload } of ATTACK_TOOLS) {
    const noApproval = checkApproval({ toolKey, payload });
    assert.strictEqual(noApproval.allowed, false);
    const withApproval = checkApproval({ toolKey, payload, approvalInput: 'APPROVE SEND' });
    assert.strictEqual(withApproval.allowed, true);
  }
});
