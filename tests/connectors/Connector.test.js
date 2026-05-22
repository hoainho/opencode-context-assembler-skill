'use strict';

const assert = require('assert');
const test = require('node:test');
const {
  REQUIRED_METHODS,
  SOURCE_ENUM,
  TASK_TYPES,
  EVIDENCE_QUALITY_REASONS,
  assertConnector,
  assertConnectorManifest,
} = require('../../src/connectors/Connector');

const VALID_CONNECTOR = {
  source: 'jira',
  match: (task) => task.task_type === 'bug-fix',
  collect: async (task) => [{ uri: 'jira://WIN-1', raw: 'data' }],
  normalize: (raw) => raw.map((r) => ({ uri: r.uri })),
};

const VALID_MANIFEST = {
  name: 'jira-connector',
  source: 'jira',
  version: '1.0.0',
  description: 'Jira ticket connector',
  task_types: ['bug-fix', 'feature', 'review'],
  mcp: { primary: 'jira_jira_issues' },
};

test('REQUIRED_METHODS lists exactly match, collect, normalize', () => {
  assert.deepStrictEqual(REQUIRED_METHODS, ['match', 'collect', 'normalize']);
});

test('SOURCE_ENUM matches source-routing-table.md and schema enum', () => {
  assert.deepStrictEqual(
    SOURCE_ENUM.slice().sort(),
    ['atoms', 'browser-repro', 'code-context', 'confluence', 'github', 'jira', 'sheets', 'slack-hybrid'].sort()
  );
});

test('TASK_TYPES matches schema enum (6 task types)', () => {
  assert.deepStrictEqual(
    TASK_TYPES.slice().sort(),
    ['bug-fix', 'feature', 'review', 'design', 'migration', 'other'].sort()
  );
});

test('EVIDENCE_QUALITY_REASONS frozen at 4 values (Oracle PR 2 S-1)', () => {
  assert.strictEqual(EVIDENCE_QUALITY_REASONS.length, 4);
  assert.deepStrictEqual(
    EVIDENCE_QUALITY_REASONS.slice().sort(),
    ['fallback-search', 'filesystem-grep', 'no-daemon', 'primary-mcp-call']
  );
});

test('assertConnector accepts a valid connector', () => {
  assertConnector(VALID_CONNECTOR);
});

test('assertConnector rejects null / non-object', () => {
  assert.throws(() => assertConnector(null), /must be an object/);
  assert.throws(() => assertConnector('string'), /must be an object/);
});

test('assertConnector rejects bad source', () => {
  assert.throws(
    () => assertConnector({ ...VALID_CONNECTOR, source: 'unknown' }),
    /connector\.source must be one of/
  );
});

test('assertConnector rejects missing methods', () => {
  for (const method of REQUIRED_METHODS) {
    const broken = { ...VALID_CONNECTOR };
    delete broken[method];
    assert.throws(() => assertConnector(broken), new RegExp(`connector\\.${method}.*function`));
  }
});

test('assertConnector rejects wrong-arity methods', () => {
  const wrongArity = { ...VALID_CONNECTOR, match: () => true };
  assert.throws(() => assertConnector(wrongArity), /match\(\) must accept exactly 1 arg/);
});

test('assertConnectorManifest accepts the v1 reference manifest', () => {
  assertConnectorManifest(VALID_MANIFEST);
});

test('assertConnectorManifest rejects null / non-object', () => {
  assert.throws(() => assertConnectorManifest(null), /must be an object/);
  assert.throws(() => assertConnectorManifest([]), /missing required field/);
});

test('assertConnectorManifest rejects missing required fields', () => {
  for (const key of ['name', 'source', 'version', 'task_types', 'mcp', 'description']) {
    const broken = { ...VALID_MANIFEST };
    delete broken[key];
    assert.throws(() => assertConnectorManifest(broken), new RegExp(`missing required field "${key}"`));
  }
});

test('assertConnectorManifest rejects empty name', () => {
  assert.throws(
    () => assertConnectorManifest({ ...VALID_MANIFEST, name: '' }),
    /name must be non-empty/
  );
});

test('assertConnectorManifest rejects bad version (not semver)', () => {
  for (const bad of ['1.0', '1', 'v1.0.0', '1.0.0-rc1']) {
    assert.throws(
      () => assertConnectorManifest({ ...VALID_MANIFEST, version: bad }),
      /version must be semver/
    );
  }
});

test('assertConnectorManifest rejects unknown source', () => {
  assert.throws(
    () => assertConnectorManifest({ ...VALID_MANIFEST, source: 'discord' }),
    /source must be one of/
  );
});

test('assertConnectorManifest rejects empty task_types or unknown entry', () => {
  assert.throws(
    () => assertConnectorManifest({ ...VALID_MANIFEST, task_types: [] }),
    /task_types must be non-empty array/
  );
  assert.throws(
    () => assertConnectorManifest({ ...VALID_MANIFEST, task_types: ['deployment'] }),
    /task_types\[\] entry "deployment"/
  );
});

test('assertConnectorManifest rejects missing mcp.primary', () => {
  assert.throws(
    () => assertConnectorManifest({ ...VALID_MANIFEST, mcp: {} }),
    /mcp\.primary must be string/
  );
});
