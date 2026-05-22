'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const {
  DEFAULT_PROTECTED,
  WRITE_VERBS,
  loadProtectedPatterns,
  matchesPattern,
  isProtectedBranch,
  parseGitCommand,
  inspectCommand,
  checkCommand,
} = require('../../src/boundaries/git-guard');

function tempRepo(yamlContent) {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'cba-gitguard-'));
  if (yamlContent !== undefined) {
    fs.mkdirSync(path.join(repo, '.opencode'), { recursive: true });
    fs.writeFileSync(path.join(repo, '.opencode', 'protected-branches.yaml'), yamlContent);
  }
  return repo;
}

test('DEFAULT_PROTECTED covers main/master/develop/release-*/hotfix-*', () => {
  for (const p of ['main', 'master', 'develop', 'release/*', 'hotfix/*']) {
    assert.ok(DEFAULT_PROTECTED.includes(p), `${p} must be default-protected`);
  }
});

test('WRITE_VERBS includes commit/push/merge', () => {
  assert.deepStrictEqual(WRITE_VERBS.slice().sort(), ['commit', 'merge', 'push']);
});

test('matchesPattern handles exact + glob wildcards', () => {
  assert.strictEqual(matchesPattern('main', 'main'), true);
  assert.strictEqual(matchesPattern('main', 'master'), false);
  assert.strictEqual(matchesPattern('release/1.0', 'release/*'), true);
  assert.strictEqual(matchesPattern('hotfix/urgent', 'hotfix/*'), true);
  assert.strictEqual(matchesPattern('feature/x', 'release/*'), false);
});

test('isProtectedBranch returns true for any matching pattern', () => {
  const patterns = ['main', 'release/*'];
  assert.strictEqual(isProtectedBranch('main', patterns), true);
  assert.strictEqual(isProtectedBranch('release/2.0', patterns), true);
  assert.strictEqual(isProtectedBranch('feature/x', patterns), false);
});

test('loadProtectedPatterns returns DEFAULT when no yaml', () => {
  const repo = tempRepo();
  assert.deepStrictEqual(loadProtectedPatterns(repo).sort(), [...DEFAULT_PROTECTED].sort());
});

test('loadProtectedPatterns parses yaml override', () => {
  const repo = tempRepo('protected_patterns:\n  - main\n  - prod/*\n');
  assert.deepStrictEqual(loadProtectedPatterns(repo), ['main', 'prod/*']);
});

test('loadProtectedPatterns throws on bad yaml', () => {
  const repo = tempRepo('protected_patterns: not-an-array\n');
  assert.throws(() => loadProtectedPatterns(repo), /expected protected_patterns/);
});

test('parseGitCommand recognizes verb + rest', () => {
  assert.deepStrictEqual(parseGitCommand('git commit -m hi'), { verb: 'commit', rest: '-m hi', raw: 'git commit -m hi' });
  assert.deepStrictEqual(parseGitCommand('git push origin main'), { verb: 'push', rest: 'origin main', raw: 'git push origin main' });
  assert.strictEqual(parseGitCommand('npm test'), null);
});

test('inspectCommand detects reset --hard, force push, commit, merge', () => {
  assert.strictEqual(inspectCommand('git reset --hard origin/main').kind, 'reset-hard');
  assert.strictEqual(inspectCommand('git push -f origin main').forcePush, true);
  assert.strictEqual(inspectCommand('git push --force origin main').forcePush, true);
  assert.strictEqual(inspectCommand('git push --force-with-lease origin main').forcePush, true);
  assert.strictEqual(inspectCommand('git push origin feature/x').forcePush, false);
  assert.strictEqual(inspectCommand('git commit -m wip').kind, 'commit');
  assert.strictEqual(inspectCommand('git merge develop').kind, 'merge');
  assert.strictEqual(inspectCommand('npm test').isGit, false);
});

const ATTACK_VECTORS = [
  { cmd: 'git commit -m wip', branch: 'main' },
  { cmd: 'git commit -m hotfix', branch: 'master' },
  { cmd: 'git commit -am all', branch: 'develop' },
  { cmd: 'git commit --amend --no-edit', branch: 'release/2.0' },
  { cmd: 'git commit -am urgent', branch: 'hotfix/123' },
  { cmd: 'git push origin main', branch: 'main' },
  { cmd: 'git push origin master', branch: 'master' },
  { cmd: 'git push origin develop', branch: 'develop' },
  { cmd: 'git push origin release/2.0', branch: 'release/2.0' },
  { cmd: 'git push origin hotfix/123', branch: 'hotfix/123' },
  { cmd: 'git merge feature/x', branch: 'main' },
  { cmd: 'git merge --squash feature/x', branch: 'develop' },
  { cmd: 'git reset --hard origin/main', branch: 'main' },
  { cmd: 'git reset --hard HEAD~3', branch: 'master' },
  { cmd: 'git reset --hard', branch: 'develop' },
  { cmd: 'git push -f origin main', branch: 'feature/x' },
  { cmd: 'git push --force origin main', branch: 'feature/x' },
  { cmd: 'git push --force-with-lease origin main', branch: 'feature/x' },
  { cmd: 'git push --force origin feature/x', branch: 'feature/x' },
  { cmd: 'git push -f origin feature/x', branch: 'feature/x' },
];

test('20/20 attack vectors REJECTED by git-guard', () => {
  const repo = tempRepo();
  for (const { cmd, branch } of ATTACK_VECTORS) {
    const result = checkCommand({ command: cmd, currentBranch: branch, repoRoot: repo });
    assert.strictEqual(result.allowed, false, `must reject: ${cmd} on ${branch} | got: ${result.reason}`);
    assert.match(result.reason, /BoundaryViolation/);
  }
});

const ALLOWED_OPS = [
  { cmd: 'git commit -m wip', branch: 'feature/x' },
  { cmd: 'git commit -am wip', branch: 'feat/pr-08' },
  { cmd: 'git push origin feature/x', branch: 'feature/x' },
  { cmd: 'git push origin feat/pr-08', branch: 'feat/pr-08' },
  { cmd: 'git merge feature/x', branch: 'feat/pr-08' },
  { cmd: 'git reset --hard origin/feature/x', branch: 'feature/x' },
  { cmd: 'git status', branch: 'main' },
  { cmd: 'git log', branch: 'main' },
  { cmd: 'git diff', branch: 'main' },
  { cmd: 'npm test', branch: 'main' },
];

test('10/10 safe operations on feature branches ALLOWED', () => {
  const repo = tempRepo();
  for (const { cmd, branch } of ALLOWED_OPS) {
    const result = checkCommand({ command: cmd, currentBranch: branch, repoRoot: repo });
    assert.strictEqual(result.allowed, true, `must allow: ${cmd} on ${branch} | got: ${result.reason}`);
  }
});

test('override with reason permits write on protected branch (audited)', () => {
  const repo = tempRepo();
  const result = checkCommand({
    command: 'git commit -m hotfix',
    currentBranch: 'main',
    repoRoot: repo,
    override: { reason: 'WIN-9999 P0 incident' },
  });
  assert.strictEqual(result.allowed, true);
  assert.strictEqual(result.override, true);
  assert.match(result.reason, /override:WIN-9999 P0 incident/);
});

test('override without reason rejected', () => {
  const repo = tempRepo();
  const result = checkCommand({
    command: 'git commit -m hi',
    currentBranch: 'main',
    repoRoot: repo,
    override: {},
  });
  assert.strictEqual(result.allowed, false);
});

test('force push has NO override path (always rejected)', () => {
  const repo = tempRepo();
  const result = checkCommand({
    command: 'git push --force origin main',
    currentBranch: 'feature/x',
    repoRoot: repo,
    override: { reason: 'I really mean it' },
  });
  assert.strictEqual(result.allowed, false);
  assert.match(result.reason, /force push.*never allowed/);
});

test('checkCommand rejects bad inputs', () => {
  assert.throws(() => checkCommand({ command: '', currentBranch: 'main', repoRoot: '/tmp' }), /non-empty string/);
  assert.throws(() => checkCommand({ command: 'git status', currentBranch: 'main', repoRoot: 'rel' }), /must be absolute/);
});
