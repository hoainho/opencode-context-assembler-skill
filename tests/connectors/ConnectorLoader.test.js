'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const {
  FORBIDDEN_IMPORT_RE,
  loadManifestFile,
  loadAllManifests,
  checkRuntimeAgnostic,
} = require('../../src/connectors/ConnectorLoader');

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cba-loader-'));
}

const VALID_YAML = `
name: jira-connector
source: jira
version: 1.0.0
description: Jira connector
task_types:
  - bug-fix
mcp:
  primary: jira_jira_issues
`;

test('FORBIDDEN_IMPORT_RE matches opencode imports', () => {
  assert.ok(FORBIDDEN_IMPORT_RE.test("require('opencode')"));
  assert.ok(FORBIDDEN_IMPORT_RE.test('import x from "opencode/foo"'));
  assert.ok(FORBIDDEN_IMPORT_RE.test("import x from '@opencode/runtime'"));
  assert.ok(!FORBIDDEN_IMPORT_RE.test("require('crypto')"));
  assert.ok(!FORBIDDEN_IMPORT_RE.test("require('./bundle-id')"));
  assert.ok(!FORBIDDEN_IMPORT_RE.test("// opencode is mentioned in a comment"));
});

test('loadManifestFile parses a valid manifest', () => {
  const dir = tempDir();
  const file = path.join(dir, 'jira.connector.yaml');
  fs.writeFileSync(file, VALID_YAML);
  const manifest = loadManifestFile(file);
  assert.strictEqual(manifest.name, 'jira-connector');
  assert.strictEqual(manifest.source, 'jira');
  assert.strictEqual(manifest.version, '1.0.0');
});

test('loadManifestFile throws on relative path', () => {
  assert.throws(() => loadManifestFile('relative.yaml'), /must be absolute/);
});

test('loadManifestFile throws on missing file', () => {
  assert.throws(() => loadManifestFile('/no/such/file.yaml'), /file not found/);
});

test('loadManifestFile throws on YAML parse error', () => {
  const dir = tempDir();
  const file = path.join(dir, 'bad.connector.yaml');
  fs.writeFileSync(file, 'name: ok\n  bad-indent: oops\nsource: [unclosed');
  assert.throws(() => loadManifestFile(file), /YAML parse error/);
});

test('loadManifestFile throws on empty manifest', () => {
  const dir = tempDir();
  const file = path.join(dir, 'empty.connector.yaml');
  fs.writeFileSync(file, '');
  assert.throws(() => loadManifestFile(file), /empty manifest/);
});

test('loadManifestFile throws on schema-invalid manifest with file path included', () => {
  const dir = tempDir();
  const file = path.join(dir, 'bad-source.connector.yaml');
  fs.writeFileSync(
    file,
    `
name: x
source: discord
version: 1.0.0
description: bad
task_types:
  - bug-fix
mcp:
  primary: x
`
  );
  assert.throws(() => loadManifestFile(file), /invalid manifest at .*bad-source\.connector\.yaml: .*source must be one of/s);
});

test('loadAllManifests skips files prefixed with underscore (templates)', () => {
  const dir = tempDir();
  fs.writeFileSync(path.join(dir, '_template.connector.yaml'), VALID_YAML);
  fs.writeFileSync(path.join(dir, 'jira.connector.yaml'), VALID_YAML);
  fs.writeFileSync(path.join(dir, 'README.md'), 'not a manifest');
  const all = loadAllManifests(dir);
  assert.strictEqual(all.length, 1);
  assert.strictEqual(all[0].filename, 'jira.connector.yaml');
});

test('loadAllManifests rejects duplicate sources', () => {
  const dir = tempDir();
  fs.writeFileSync(path.join(dir, 'a.connector.yaml'), VALID_YAML);
  fs.writeFileSync(path.join(dir, 'b.connector.yaml'), VALID_YAML);
  assert.throws(() => loadAllManifests(dir), /duplicate source "jira"/);
});

test('loadAllManifests rejects relative dir', () => {
  assert.throws(() => loadAllManifests('relative'), /must be absolute/);
});

test('checkRuntimeAgnostic returns 0 violations on clean code', () => {
  const dir = tempDir();
  fs.writeFileSync(
    path.join(dir, 'clean.js'),
    `'use strict';
const fs = require('fs');
module.exports = {};
`
  );
  const violations = checkRuntimeAgnostic(dir);
  assert.deepStrictEqual(violations, []);
});

test('checkRuntimeAgnostic flags forbidden imports', () => {
  const dir = tempDir();
  fs.writeFileSync(
    path.join(dir, 'bad.js'),
    `const x = require('opencode/runtime');
const y = require('@opencode/foo');
`
  );
  const violations = checkRuntimeAgnostic(dir);
  assert.strictEqual(violations.length, 2);
  assert.match(violations[0].snippet, /opencode/);
  assert.strictEqual(violations[0].line, 1);
});

test('checkRuntimeAgnostic walks subdirectories', () => {
  const dir = tempDir();
  fs.mkdirSync(path.join(dir, 'sub'));
  fs.writeFileSync(
    path.join(dir, 'sub', 'leaf.js'),
    `import x from 'opencode/leaf';\n`
  );
  const violations = checkRuntimeAgnostic(dir);
  assert.strictEqual(violations.length, 1);
});

test('checkRuntimeAgnostic ignores non-source files', () => {
  const dir = tempDir();
  fs.writeFileSync(path.join(dir, 'notes.md'), `import x from 'opencode/leaf';`);
  fs.writeFileSync(path.join(dir, 'data.json'), `{}`);
  const violations = checkRuntimeAgnostic(dir);
  assert.deepStrictEqual(violations, []);
});

test('PR 5 self-check: connector source code is runtime-agnostic (F-3 regression)', () => {
  const srcConnectors = path.resolve(__dirname, '..', '..', 'src', 'connectors');
  const violations = checkRuntimeAgnostic(srcConnectors);
  assert.deepStrictEqual(
    violations,
    [],
    `Found ${violations.length} forbidden imports: ${JSON.stringify(violations, null, 2)}`
  );
});

test('PR 5 self-check: shipped _template.connector.yaml is loadable AND skipped by loader', () => {
  const connectorsDir = path.resolve(__dirname, '..', '..', 'connectors');
  const templatePath = path.join(connectorsDir, '_template.connector.yaml');
  assert.ok(fs.existsSync(templatePath), 'template manifest must exist');
  const manifest = loadManifestFile(templatePath);
  assert.strictEqual(manifest.source, 'jira');
  const all = loadAllManifests(connectorsDir);
  assert.strictEqual(all.length, 0, 'underscore-prefixed templates must be skipped');
});
