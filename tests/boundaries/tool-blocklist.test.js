'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const {
  DEFAULT_PATTERNS,
  loadBlocklist,
  compilePatterns,
  isDestructive,
  checkCommand,
} = require('../../src/boundaries/tool-blocklist');

function tempRepo(yamlContent) {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'cba-tool-'));
  if (yamlContent !== undefined) {
    fs.mkdirSync(path.join(repo, '.opencode'), { recursive: true });
    fs.writeFileSync(path.join(repo, '.opencode', 'tool-blocklist.yaml'), yamlContent);
  }
  return repo;
}

test('DEFAULT_PATTERNS covers rm-rf, DROP TABLE, force push, dd, mkfs, fork bomb', () => {
  const joined = DEFAULT_PATTERNS.join(' | ');
  assert.match(joined, /rm/);
  assert.match(joined, /DROP/);
  assert.match(joined, /TRUNCATE/);
  assert.match(joined, /force/);
  assert.match(joined, /filter-branch/);
  assert.match(joined, /mkfs/);
  assert.match(joined, /dd/);
});

test('loadBlocklist returns defaults when no yaml', () => {
  const repo = tempRepo();
  assert.deepStrictEqual(loadBlocklist(repo), DEFAULT_PATTERNS);
});

test('loadBlocklist parses yaml override', () => {
  const repo = tempRepo('blocklist:\n  - \'foo\\s+bar\'\n  - \'baz\'\n');
  assert.deepStrictEqual(loadBlocklist(repo), ['foo\\s+bar', 'baz']);
});

test('loadBlocklist throws on bad yaml', () => {
  const repo = tempRepo('blocklist: not-an-array\n');
  assert.throws(() => loadBlocklist(repo), /expected blocklist/);
});

test('loadBlocklist rejects relative repoRoot', () => {
  assert.throws(() => loadBlocklist('rel'), /must be absolute/);
});

test('compilePatterns rejects invalid regex', () => {
  assert.throws(() => compilePatterns(['[unclosed']), /invalid regex/);
});

const DESTRUCTIVE_CASES = [
  'rm -rf /',
  'rm -rf ~',
  'rm -rf *',
  'DROP TABLE players;',
  'drop table players;',
  'DROP DATABASE prod;',
  'TRUNCATE TABLE Sessions;',
  'DELETE FROM Users;',
  'git push --force origin main',
  'git push -f origin main',
  'git push --force-with-lease origin main',
  'git reset --hard origin/main',
  'git filter-branch --tree-filter rm secret',
  'git update-ref -d refs/heads/main',
  'mkfs.ext4 /dev/sda1',
  'dd if=/dev/zero of=/dev/sda',
];

const SAFE_CASES = [
  'npm test',
  'npm install',
  'git status',
  'git log -5',
  'git diff',
  'rm -rf node_modules',
  'rm -rf dist',
  'ls -la',
  'cat README.md',
  'grep -r "foo" src/',
  'mkdir -p tests/fixtures',
  'cp file.txt backup.txt',
  'echo "hi" > out.txt',
  'curl https://example.com',
  'node script.js',
];

test('16 destructive commands all BLOCKED', () => {
  const repo = tempRepo();
  for (const cmd of DESTRUCTIVE_CASES) {
    const result = checkCommand({ command: cmd, repoRoot: repo });
    assert.strictEqual(result.allowed, false, `must block: "${cmd}"`);
    assert.match(result.reason, /BoundaryViolation/);
    assert.ok(result.matched_pattern, 'must report matched pattern');
  }
});

test('15 safe commands all ALLOWED', () => {
  const repo = tempRepo();
  for (const cmd of SAFE_CASES) {
    const result = checkCommand({ command: cmd, repoRoot: repo });
    assert.strictEqual(result.allowed, true, `must allow: "${cmd}" | ${result.reason}`);
  }
});

test('isDestructive accepts explicit patterns override', () => {
  const result = isDestructive({ command: 'foo bar', patterns: ['foo\\s+bar'] });
  assert.strictEqual(result.destructive, true);
});

test('NO override path: destructive commands have no escape hatch', () => {
  const repo = tempRepo();
  for (const cmd of DESTRUCTIVE_CASES) {
    const result = checkCommand({ command: cmd, repoRoot: repo });
    assert.strictEqual(result.allowed, false);
    assert.match(result.reason, /no override path/);
  }
});

test('checkCommand rejects empty command', () => {
  const repo = tempRepo();
  assert.throws(() => checkCommand({ command: '', repoRoot: repo }), /non-empty string/);
});
