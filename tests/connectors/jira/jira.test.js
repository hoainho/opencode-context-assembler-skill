'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const test = require('node:test');
const { createJiraConnector } = require('../../../src/connectors/jira');
const { match } = require('../../../src/connectors/jira/match');
const { collect, PRIMARY_MCP, COMMENTS_MCP, LINKS_MCP, FALLBACK_MCP } = require('../../../src/connectors/jira/collect');
const { normalize, extractText, scoreRelevance } = require('../../../src/connectors/jira/normalize');
const { assertConnector } = require('../../../src/connectors/Connector');

const FIX_DIR = path.join(__dirname, 'fixtures');

function loadFixture(name) {
  return JSON.parse(fs.readFileSync(path.join(FIX_DIR, name), 'utf8'));
}

function makeMcpClient(fixture, failures = {}) {
  return {
    async call(tool, args) {
      if (failures[tool]) throw new Error(failures[tool]);
      if (tool === PRIMARY_MCP) return fixture.issue;
      if (tool === COMMENTS_MCP) return fixture.comments;
      if (tool === LINKS_MCP) return fixture.links;
      if (tool === FALLBACK_MCP) return fixture.search;
      throw new Error(`unexpected tool: ${tool}`);
    },
  };
}

test('createJiraConnector instance implements assertConnector contract (arity-1 collect)', () => {
  const fakeMcp = { call: async () => null };
  const instance = createJiraConnector({ mcpClient: fakeMcp });
  assertConnector(instance);
  assert.strictEqual(instance.source, 'jira');
});

test('createJiraConnector rejects missing mcpClient', () => {
  assert.throws(() => createJiraConnector({}), /mcpClient\.call must be a function/);
  assert.throws(() => createJiraConnector(), /mcpClient\.call must be a function/);
});

test('default-exported collect (no mcpClient) throws a helpful error', async () => {
  const stub = require('../../../src/connectors/jira');
  await assert.rejects(stub.collect({}), /createJiraConnector/);
});

test('match: returns true for bug-fix with Jira ticket reference', () => {
  const task = {
    task_type: 'bug-fix',
    references: [{ kind: 'ticket', value: 'WIN-7993' }],
  };
  assert.strictEqual(match(task), true);
});

test('match: returns false for design/migration task types', () => {
  for (const tt of ['design', 'migration', 'other']) {
    const task = { task_type: tt, references: [{ kind: 'ticket', value: 'WIN-1' }] };
    assert.strictEqual(match(task), false);
  }
});

test('match: returns false when no ticket references', () => {
  const task = {
    task_type: 'bug-fix',
    references: [{ kind: 'pr', value: '#100' }, { kind: 'url', value: 'https://x' }],
  };
  assert.strictEqual(match(task), false);
});

test('match: returns false for malformed input', () => {
  assert.strictEqual(match(null), false);
  assert.strictEqual(match({}), false);
  assert.strictEqual(match({ task_type: 'bug-fix' }), false);
  assert.strictEqual(match({ task_type: 'bug-fix', references: 'string' }), false);
});

test('collect: WIN-7993 primary path yields issue + comments + links', async () => {
  const fixture = loadFixture('01-WIN-7993.json');
  const mcpClient = makeMcpClient(fixture);
  const task = {
    task_type: 'bug-fix',
    references: [{ kind: 'ticket', value: 'WIN-7993' }],
    raw_text: 'fix WIN-7993 daily bonus auto-claim',
  };
  const { raw, gaps } = await collect(task, { mcpClient });
  assert.strictEqual(gaps.length, 0);
  assert.ok(raw.length >= 3, `expected >=3 raw items (issue + comment + link), got ${raw.length}`);
  const uris = raw.map((r) => r.uri);
  assert.ok(uris.includes('jira://WIN-7993'));
  assert.ok(uris.some((u) => u.includes('/comment/')));
  assert.ok(uris.some((u) => u.includes('/link/')));
  for (const r of raw) {
    assert.strictEqual(r.evidence_quality, 'verified');
    assert.strictEqual(r.evidence_quality_reason, 'primary-mcp-call');
    assert.ok(r.mcp_used);
    assert.ok(r.query_issued);
  }
});

test('collect: empty results trigger fallback search', async () => {
  const fixture = loadFixture('05-WIN-fallback.json');
  const mcpClient = makeMcpClient(fixture);
  const task = {
    task_type: 'bug-fix',
    references: [{ kind: 'ticket', value: 'WIN-9999' }],
    raw_text: 'daily bonus stale',
  };
  const { raw, gaps } = await collect(task, { mcpClient });
  assert.strictEqual(gaps.length, 0);
  assert.strictEqual(raw.length, 2);
  for (const r of raw) {
    assert.strictEqual(r.evidence_quality, 'degraded');
    assert.strictEqual(r.evidence_quality_reason, 'fallback-search');
    assert.strictEqual(r.mcp_used, FALLBACK_MCP);
  }
});

test('collect: emits gap when MCP unavailable (no silent skip per F-1)', async () => {
  const fixture = loadFixture('01-WIN-7993.json');
  const mcpClient = makeMcpClient(fixture, { [PRIMARY_MCP]: 'auth refresh required' });
  const task = {
    task_type: 'bug-fix',
    references: [{ kind: 'ticket', value: 'WIN-7993' }],
    raw_text: 'fix',
  };
  const { raw, gaps } = await collect(task, { mcpClient });
  assert.strictEqual(raw.length, 0);
  assert.strictEqual(gaps.length, 1);
  assert.strictEqual(gaps[0].expected, 'WIN-7993');
  assert.match(gaps[0].reason, /jira_jira_issues unavailable.*auth refresh/);
});

test('collect: empty result + no fallback hits emits "not found" gap', async () => {
  const fixture = loadFixture('04-WIN-empty.json');
  const mcpClient = makeMcpClient(fixture);
  const task = {
    task_type: 'bug-fix',
    references: [{ kind: 'ticket', value: 'WIN-9999' }],
    raw_text: 'nothing matches',
  };
  const { raw, gaps } = await collect(task, { mcpClient });
  assert.strictEqual(raw.length, 0);
  assert.strictEqual(gaps.length, 1);
  assert.match(gaps[0].reason, /no Jira ticket found/);
});

test('collect: rejects bad task / missing mcpClient', async () => {
  await assert.rejects(collect(null, { mcpClient: {} }), /task must be an object/);
  await assert.rejects(collect({}, {}), /mcpClient\.call must be a function/);
});

test('normalize: produces ContextItem shape from raw collect output', async () => {
  const fixture = loadFixture('01-WIN-7993.json');
  const mcpClient = makeMcpClient(fixture);
  const task = {
    task_type: 'bug-fix',
    references: [{ kind: 'ticket', value: 'WIN-7993' }],
    raw_text: 'fix WIN-7993 daily bonus',
    created_by: 'tester@example.com',
  };
  const { raw } = await collect(task, { mcpClient });
  const items = normalize(raw, task);
  assert.ok(items.length >= 3);
  for (const item of items) {
    assert.ok(item.uri.startsWith('jira://'));
    assert.ok(item.name);
    assert.strictEqual(item.source, 'jira');
    assert.strictEqual(item.fetched_by, 'tester@example.com');
    assert.strictEqual(item.approved, false);
    assert.ok(item.relevance_score > 0);
    assert.ok(item.relevance_reason);
    assert.strictEqual(item.evidence_quality, 'verified');
    assert.strictEqual(item.evidence_quality_reason, 'primary-mcp-call');
    assert.ok(item.mcp_used);
    assert.ok(item.query_issued);
    assert.strictEqual(item.mimeType, 'text/markdown');
    assert.ok(item.content.length > 0);
  }
});

test('normalize: scoreRelevance assigns 0.95 for exact-ticket-match', () => {
  const item = { uri: 'jira://WIN-7993', source_ref: 'WIN-7993', evidence_quality: 'verified', payload: {} };
  const task = { raw_text: 'fix WIN-7993', references: [{ kind: 'ticket', value: 'WIN-7993' }] };
  const { score, reason } = scoreRelevance(item, task);
  assert.strictEqual(score, 0.95);
  assert.strictEqual(reason, 'exact-ticket-match');
});

test('normalize: scoreRelevance assigns 0.5 for fallback-search', () => {
  const item = { uri: 'jira://WIN-7900', source_ref: 'WIN-7900', evidence_quality: 'degraded', payload: {} };
  const task = { raw_text: 'fix WIN-9999', references: [{ kind: 'ticket', value: 'WIN-9999' }] };
  const { score, reason } = scoreRelevance(item, task);
  assert.strictEqual(score, 0.5);
  assert.strictEqual(reason, 'fallback-search-result');
});

test('normalize: rejects non-array input', () => {
  assert.throws(() => normalize(null, {}), /rawList must be an array/);
  assert.throws(() => normalize('string', {}), /rawList must be an array/);
});

test('extractText: assembles SUMMARY/DESCRIPTION/AUTHOR/STATUS/PRIORITY', () => {
  const text = extractText({
    payload: {
      summary: 'Fix bug',
      description: 'Players see spinner',
      author: { displayName: 'Alice' },
      status: { name: 'Open' },
      priority: { name: 'High' },
    },
  });
  assert.match(text, /SUMMARY: Fix bug/);
  assert.match(text, /DESCRIPTION: Players see spinner/);
  assert.match(text, /AUTHOR: Alice/);
  assert.match(text, /STATUS: Open/);
  assert.match(text, /PRIORITY: High/);
});

test('end-to-end: 5 fixtures all produce valid ContextItems matching schema fields', async () => {
  const fixtures = ['01-WIN-7993.json', '02-WIN-6884.json', '03-WIN-7518.json', '04-WIN-empty.json', '05-WIN-fallback.json'];
  const ticketIds = ['WIN-7993', 'WIN-6884', 'WIN-7518', 'WIN-9999', 'WIN-9999'];
  for (let i = 0; i < fixtures.length; i++) {
    const fixture = loadFixture(fixtures[i]);
    const mcpClient = makeMcpClient(fixture);
    const task = {
      task_type: 'bug-fix',
      references: [{ kind: 'ticket', value: ticketIds[i] }],
      raw_text: `fix ${ticketIds[i]}`,
      created_by: 'tester@example.com',
    };
    const { raw, gaps } = await collect(task, { mcpClient });
    const items = normalize(raw, task);
    for (const item of items) {
      assert.ok(item.uri && item.uri.length > 0);
      assert.ok(item.name);
      assert.ok(item.content);
      assert.strictEqual(item.source, 'jira');
      assert.ok(typeof item.relevance_score === 'number' && item.relevance_score >= 0 && item.relevance_score <= 1);
      assert.ok(['verified', 'degraded', 'partial'].includes(item.evidence_quality));
      assert.ok(['primary-mcp-call', 'fallback-search', 'filesystem-grep', 'no-daemon'].includes(item.evidence_quality_reason));
    }
    if (fixtures[i] === '04-WIN-empty.json') {
      assert.strictEqual(items.length, 0);
      assert.ok(gaps.length > 0);
    }
  }
});
