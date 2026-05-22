'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const test = require('node:test');
const { createGithubConnector } = require('../../../src/connectors/github');
const { match, parsePrRef, GITHUB_URL_RE } = require('../../../src/connectors/github/match');
const { collect, PRIMARY_MCP, FILES_MCP, REVIEWS_MCP, FALLBACK_MCP } = require('../../../src/connectors/github/collect');
const { normalize, extractText, scoreRelevance } = require('../../../src/connectors/github/normalize');
const { assertConnector } = require('../../../src/connectors/Connector');

const FIX_DIR = path.join(__dirname, 'fixtures');

function loadFixture(name) {
  return JSON.parse(fs.readFileSync(path.join(FIX_DIR, name), 'utf8'));
}

function makeMcpClient(fixture, failures = {}) {
  return {
    async call(tool, args) {
      if (failures[tool]) throw new Error(failures[tool]);
      if (tool === PRIMARY_MCP) return fixture.pr;
      if (tool === FILES_MCP) return fixture.files;
      if (tool === REVIEWS_MCP) return fixture.reviews;
      if (tool === FALLBACK_MCP) return fixture.search;
      throw new Error(`unexpected tool: ${tool}`);
    },
  };
}

test('createGithubConnector instance implements assertConnector contract', () => {
  const instance = createGithubConnector({ mcpClient: { call: async () => null } });
  assertConnector(instance);
  assert.strictEqual(instance.source, 'github');
});

test('createGithubConnector rejects missing mcpClient', () => {
  assert.throws(() => createGithubConnector({}), /mcpClient\.call must be a function/);
  assert.throws(() => createGithubConnector(), /mcpClient\.call must be a function/);
});

test('default-exported collect (no mcpClient) throws helpful error', async () => {
  const stub = require('../../../src/connectors/github');
  await assert.rejects(stub.collect({}), /createGithubConnector/);
});

test('GITHUB_URL_RE matches pull + issue URLs', () => {
  assert.ok(GITHUB_URL_RE.test('https://github.com/hoainho/repo/pull/4821'));
  assert.ok(GITHUB_URL_RE.test('http://github.com/owner/repo/issues/1234'));
  assert.ok(!GITHUB_URL_RE.test('https://gitlab.com/owner/repo/pull/4821'));
});

test('parsePrRef: pr kind', () => {
  assert.deepStrictEqual(
    parsePrRef({ kind: 'pr', value: '#100', number: 100 }),
    { number: 100, owner: null, repo: null }
  );
});

test('parsePrRef: github URL extracts owner/repo/number', () => {
  const out = parsePrRef({ kind: 'url', value: 'https://github.com/hoainho/repo/pull/4821' });
  assert.deepStrictEqual(out, { owner: 'hoainho', repo: 'repo', number: 4821 });
});

test('parsePrRef: returns null for non-github', () => {
  assert.strictEqual(parsePrRef({ kind: 'url', value: 'https://google.com' }), null);
  assert.strictEqual(parsePrRef({ kind: 'ticket', value: 'WIN-1' }), null);
  assert.strictEqual(parsePrRef(null), null);
});

test('match: returns true for bug-fix with PR reference', () => {
  const task = {
    task_type: 'bug-fix',
    references: [{ kind: 'pr', value: '#4821', number: 4821 }],
  };
  assert.strictEqual(match(task), true);
});

test('match: returns true for review + URL reference', () => {
  const task = {
    task_type: 'review',
    references: [{ kind: 'url', value: 'https://github.com/o/r/pull/100' }],
  };
  assert.strictEqual(match(task), true);
});

test('match: returns false for design/migration/other', () => {
  for (const tt of ['design', 'migration', 'other']) {
    const task = { task_type: tt, references: [{ kind: 'pr', value: '#1', number: 1 }] };
    assert.strictEqual(match(task), false);
  }
});

test('match: returns false when no PR reference', () => {
  const task = {
    task_type: 'bug-fix',
    references: [{ kind: 'ticket', value: 'WIN-1' }],
  };
  assert.strictEqual(match(task), false);
});

test('match: returns false for malformed input', () => {
  assert.strictEqual(match(null), false);
  assert.strictEqual(match({}), false);
  assert.strictEqual(match({ task_type: 'bug-fix' }), false);
});

test('collect: primary path yields PR + files + reviews', async () => {
  const fixture = loadFixture('01-pr-4821.json');
  const mcpClient = makeMcpClient(fixture);
  const task = {
    task_type: 'bug-fix',
    references: [{ kind: 'pr', value: '#4821', number: 4821 }],
    raw_text: 'review #4821 leaderboard refresh',
    repo_context: { owner: 'hoainho', repo: 'playsweeps-web' },
  };
  const { raw, gaps } = await collect(task, { mcpClient });
  assert.strictEqual(gaps.length, 0);
  assert.ok(raw.length >= 4, `expected >=4 raw (PR + 2 files + 1 review), got ${raw.length}`);
  const uris = raw.map((r) => r.uri);
  assert.ok(uris.includes('github://hoainho/playsweeps-web/pull/4821'));
  assert.ok(uris.some((u) => u.includes('/file/')));
  assert.ok(uris.some((u) => u.includes('/review/')));
  for (const r of raw) {
    assert.strictEqual(r.evidence_quality, 'verified');
    assert.strictEqual(r.evidence_quality_reason, 'primary-mcp-call');
    assert.ok(r.mcp_used);
    assert.ok(r.query_issued);
  }
});

test('collect: PR URL reference resolves owner/repo from URL itself', async () => {
  const fixture = loadFixture('02-pr-2900.json');
  const mcpClient = makeMcpClient(fixture);
  const task = {
    task_type: 'review',
    references: [{ kind: 'url', value: 'https://github.com/playsweeps/web/pull/2900' }],
    raw_text: 'review',
  };
  const { raw, gaps } = await collect(task, { mcpClient });
  assert.strictEqual(gaps.length, 0);
  const uris = raw.map((r) => r.uri);
  assert.ok(uris.includes('github://playsweeps/web/pull/2900'));
});

test('collect: owner/repo unresolvable emits gap', async () => {
  const fixture = loadFixture('01-pr-4821.json');
  const mcpClient = makeMcpClient(fixture);
  const task = {
    task_type: 'bug-fix',
    references: [{ kind: 'pr', value: '#999', number: 999 }],
    raw_text: 'fix',
  };
  const { raw, gaps } = await collect(task, { mcpClient });
  assert.strictEqual(raw.length, 0);
  assert.strictEqual(gaps.length, 1);
  assert.match(gaps[0].reason, /owner\/repo not resolvable/);
});

test('collect: primary unavailable emits gap (F-1)', async () => {
  const fixture = loadFixture('01-pr-4821.json');
  const mcpClient = makeMcpClient(fixture, { [PRIMARY_MCP]: 'rate limit hit' });
  const task = {
    task_type: 'bug-fix',
    references: [{ kind: 'pr', value: '#4821', number: 4821 }],
    raw_text: 'fix',
    repo_context: { owner: 'hoainho', repo: 'playsweeps-web' },
  };
  const { raw, gaps } = await collect(task, { mcpClient });
  assert.strictEqual(raw.length, 0);
  assert.strictEqual(gaps.length, 1);
  assert.match(gaps[0].reason, /github_get_pull_request unavailable.*rate limit/);
});

test('collect: primary empty + fallback code search returns degraded items', async () => {
  const fixture = { pr: null, files: { files: [] }, reviews: { reviews: [] }, search: { items: [{ path: 'src/foo.ts' }, { path: 'src/bar.ts' }] } };
  const mcpClient = makeMcpClient(fixture);
  const task = {
    task_type: 'bug-fix',
    references: [{ kind: 'pr', value: '#9999', number: 9999 }],
    raw_text: 'leaderboard refresh',
    repo_context: { owner: 'hoainho', repo: 'playsweeps-web' },
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

test('collect: fallback hit without path is SKIPPED (S2 hardening)', async () => {
  const fixture = { pr: null, files: { files: [] }, reviews: { reviews: [] }, search: { items: [{ path: 'good.ts' }, { name: 'bad-no-path' }, null] } };
  const mcpClient = makeMcpClient(fixture);
  const task = {
    task_type: 'bug-fix',
    references: [{ kind: 'pr', value: '#1', number: 1 }],
    raw_text: 'test',
    repo_context: { owner: 'o', repo: 'r' },
  };
  const { raw } = await collect(task, { mcpClient });
  assert.strictEqual(raw.length, 1, 'malformed search hits must be filtered, not turned into github://undefined URIs');
  assert.ok(raw[0].uri.endsWith('good.ts'));
});

test('collect: primary empty + fallback empty emits "no hits" gap', async () => {
  const fixture = loadFixture('04-pr-empty.json');
  const mcpClient = makeMcpClient(fixture);
  const task = {
    task_type: 'bug-fix',
    references: [{ kind: 'pr', value: '#9999', number: 9999 }],
    raw_text: 'nothing here',
    repo_context: { owner: 'o', repo: 'r' },
  };
  const { raw, gaps } = await collect(task, { mcpClient });
  assert.strictEqual(raw.length, 0);
  assert.strictEqual(gaps.length, 1);
  assert.match(gaps[0].reason, /no GitHub PR or code search hits/);
});

test('collect: rejects bad task / missing mcpClient', async () => {
  await assert.rejects(collect(null, { mcpClient: {} }), /task must be an object/);
  await assert.rejects(collect({}, {}), /mcpClient\.call must be a function/);
});

test('normalize: produces ContextItem shape', async () => {
  const fixture = loadFixture('01-pr-4821.json');
  const mcpClient = makeMcpClient(fixture);
  const task = {
    task_type: 'review',
    references: [{ kind: 'pr', value: '#4821', number: 4821 }],
    raw_text: 'review #4821',
    created_by: 'tester@example.com',
    repo_context: { owner: 'hoainho', repo: 'playsweeps-web' },
  };
  const { raw } = await collect(task, { mcpClient });
  const items = normalize(raw, task);
  assert.ok(items.length >= 4);
  for (const item of items) {
    assert.ok(item.uri.startsWith('github://'));
    assert.ok(item.name);
    assert.strictEqual(item.source, 'github');
    assert.strictEqual(item.fetched_by, 'tester@example.com');
    assert.strictEqual(item.approved, false);
    assert.ok(typeof item.relevance_score === 'number');
    assert.ok(item.relevance_reason);
    assert.ok(['verified', 'degraded', 'partial'].includes(item.evidence_quality));
    assert.ok(['primary-mcp-call', 'fallback-search', 'filesystem-grep', 'no-daemon'].includes(item.evidence_quality_reason));
    assert.ok(item.mcp_used);
    assert.ok(item.query_issued);
    assert.strictEqual(item.mimeType, 'text/markdown');
  }
});

test('normalize: fetched_at is SAME across all items in one call (S3 hardening)', async () => {
  const fixture = loadFixture('01-pr-4821.json');
  const mcpClient = makeMcpClient(fixture);
  const task = {
    task_type: 'review',
    references: [{ kind: 'pr', value: '#4821', number: 4821 }],
    raw_text: 'review',
    repo_context: { owner: 'hoainho', repo: 'playsweeps-web' },
  };
  const { raw } = await collect(task, { mcpClient });
  const items = normalize(raw, task);
  const timestamps = new Set(items.map((i) => i.fetched_at));
  assert.strictEqual(timestamps.size, 1, 'all items in one normalize call must share fetched_at');
});

test('scoreRelevance: exact PR reference = 0.95', () => {
  const item = { uri: 'github://o/r/pull/100', source_ref: 'o/r#100', evidence_quality: 'verified' };
  const { score, reason } = scoreRelevance(item, {});
  assert.strictEqual(score, 0.95);
  assert.strictEqual(reason, 'exact-pr-reference');
});

test('scoreRelevance: PR child artifact (file/review) = 0.75', () => {
  const file = { uri: 'github://o/r/pull/100/file/x.ts', evidence_quality: 'verified' };
  const review = { uri: 'github://o/r/pull/100/review/r1', evidence_quality: 'verified' };
  assert.strictEqual(scoreRelevance(file, {}).score, 0.75);
  assert.strictEqual(scoreRelevance(review, {}).score, 0.75);
});

test('scoreRelevance: fallback-search = 0.5', () => {
  const item = { uri: 'github://o/r/code/foo.ts', evidence_quality: 'degraded' };
  assert.strictEqual(scoreRelevance(item, {}).score, 0.5);
});

test('extractText: assembles TITLE/BODY/AUTHOR/STATE/DIFF/PATCH', () => {
  const text = extractText({
    payload: {
      title: 'Fix bug',
      body: 'Description here',
      user: { login: 'tester' },
      state: 'open',
      filename: 'foo.ts',
      additions: 10,
      deletions: 5,
      patch: '@@\n+ new line',
    },
  });
  assert.match(text, /TITLE: Fix bug/);
  assert.match(text, /BODY: Description here/);
  assert.match(text, /AUTHOR: tester/);
  assert.match(text, /STATE: open/);
  assert.match(text, /FILE: foo.ts/);
  assert.match(text, /DIFF: \+10\/-5 lines/);
  assert.match(text, /PATCH:/);
});

test('end-to-end: 3 PR fixtures all produce schema-valid items', async () => {
  const fixtures = ['01-pr-4821.json', '02-pr-2900.json', '03-pr-5012.json'];
  for (const fname of fixtures) {
    const fixture = loadFixture(fname);
    const mcpClient = makeMcpClient(fixture);
    const task = {
      task_type: 'review',
      references: [{ kind: 'pr', value: `#${fixture.pr.number}`, number: fixture.pr.number }],
      raw_text: `review #${fixture.pr.number}`,
      created_by: 'tester@example.com',
      repo_context: { owner: 'hoainho', repo: 'repo' },
    };
    const { raw } = await collect(task, { mcpClient });
    const items = normalize(raw, task);
    assert.ok(items.length >= 1, `fixture ${fname} produced 0 items`);
    for (const item of items) {
      assert.ok(item.uri);
      assert.strictEqual(item.source, 'github');
      assert.ok(item.content.length > 0);
      assert.ok(typeof item.relevance_score === 'number' && item.relevance_score >= 0 && item.relevance_score <= 1);
    }
  }
});
