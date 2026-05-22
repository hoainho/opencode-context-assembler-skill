'use strict';

const assert = require('assert');
const test = require('node:test');
const {
  FALLBACK_QUESTIONS,
  tokenize,
  extractReferences,
  detectVerb,
  detectScopeWindow,
  classifyTaskType,
  parseIntent,
} = require('../../src/intent/parser');

test('tokenize lowercases, strips punct, splits on whitespace', () => {
  assert.deepStrictEqual(tokenize('Fix WIN-7993, ASAP!'), ['fix', 'win-7993', 'asap']);
  assert.deepStrictEqual(tokenize(''), []);
  assert.deepStrictEqual(tokenize(null), []);
});

test('extractReferences finds Jira tickets, PRs, URLs, and @mentions without dupes', () => {
  const refs = extractReferences(
    'Fix WIN-7993 and review #4821, see https://jira.example.com/browse/WIN-7993 cc @van.nguyen #4821'
  );
  const kinds = refs.map((r) => `${r.kind}:${r.value}`);
  assert.ok(kinds.includes('ticket:WIN-7993'));
  assert.ok(kinds.includes('pr:#4821'));
  assert.ok(kinds.includes('url:https://jira.example.com/browse/WIN-7993'));
  assert.ok(kinds.includes('mention:@van.nguyen'));
  assert.strictEqual(kinds.filter((k) => k === 'ticket:WIN-7993').length, 1, 'ticket dedup');
  assert.strictEqual(kinds.filter((k) => k === 'pr:#4821').length, 1, 'pr dedup');
});

test('extractReferences supports multiple Jira projects', () => {
  const refs = extractReferences('Compare WIN-7993 with PROJ-123 vs ABC-99');
  const tickets = refs.filter((r) => r.kind === 'ticket').map((r) => r.value);
  assert.deepStrictEqual(tickets.sort(), ['ABC-99', 'PROJ-123', 'WIN-7993']);
});

test('detectVerb finds primary action verb', () => {
  assert.strictEqual(detectVerb('fix WIN-1'), 'fix');
  assert.strictEqual(detectVerb('Implement leaderboard refresh'), 'implement');
  assert.strictEqual(detectVerb('please review PR #5'), 'review');
  assert.strictEqual(detectVerb('design the auth system'), 'design');
  assert.strictEqual(detectVerb('migrate from Redux to RTK Query'), 'migrate');
  assert.strictEqual(detectVerb('hello there'), null);
});

test('detectScopeWindow recognizes relative, since-sprint, absolute, this-period, all-time', () => {
  assert.deepStrictEqual(detectScopeWindow('look at last 7 days of commits').kind, 'relative');
  assert.deepStrictEqual(detectScopeWindow('changes since sprint 80').kind, 'sprint-start');
  assert.deepStrictEqual(detectScopeWindow('updates since 2026-05-01').kind, 'absolute');
  assert.deepStrictEqual(detectScopeWindow('this week activity').kind, 'this-period');
  assert.deepStrictEqual(detectScopeWindow('all-time history').kind, 'all-time');
  assert.strictEqual(detectScopeWindow('no time hint here'), null);
});

test('FALLBACK_QUESTIONS has exactly 3 templated questions', () => {
  assert.strictEqual(FALLBACK_QUESTIONS.length, 3);
  for (const q of FALLBACK_QUESTIONS) {
    assert.ok(q.endsWith(')'), 'each fallback question carries an example');
    assert.ok(q.length > 30, 'each fallback question is substantive');
  }
});

const FIXTURE_INTENTS = [
  { text: 'fix WIN-7993 daily bonus auto-claim stuck', expected: 'bug-fix' },
  { text: 'implement tournament leaderboard refresh feature', expected: 'feature' },
  { text: 'review PR #2900 in playsweeps-web', expected: 'review' },
  { text: 'design the auth retry architecture for kyc flow', expected: 'design' },
  { text: 'migrate from redux-saga to rtk-query in checkout module', expected: 'migration' },
  { text: 'debug why leaderboard rank is stale for 3 minutes after award', expected: 'bug-fix' },
  { text: 'add support for skrill payment method WIN-6650', expected: 'feature' },
  { text: 'code review the auth saga changes in #4821', expected: 'review' },
  { text: 'spike on mfa cooldown reset architecture', expected: 'design' },
  { text: 'refactor to use new dapper sql helper across all services', expected: 'migration' },
  { text: 'investigate WIN-7906 daily bonus reload regression', expected: 'bug-fix' },
  { text: 'build the lootbox award engine for sprint 80', expected: 'feature' },
  { text: 'pr review for #5012 — kyc webhook retries', expected: 'review' },
  { text: 'evaluate options and tradeoffs for slack notification fanout', expected: 'design' },
  { text: 'port to typescript strict mode in playsweeps-web', expected: 'migration' },
  { text: 'why does paymentMachine deadlock on KYC_REJECTED transition', expected: 'bug-fix' },
  { text: 'introduce new feature flag for cheat redemption admin endpoint', expected: 'feature' },
  { text: 'audit pr #4900 for security regressions in auth saga', expected: 'review' },
  { text: 'flaky tournament leaderboard test stuck in CI', expected: 'bug-fix' },
  { text: 'rfc proposal for sprint planning automation', expected: 'design' },
];

test('classifyTaskType correctly classifies >=18/20 fixture intents (plan PR 6 acceptance)', () => {
  let correct = 0;
  const wrong = [];
  for (const fx of FIXTURE_INTENTS) {
    const { task_type } = classifyTaskType(fx.text);
    if (task_type === fx.expected) {
      correct++;
    } else {
      wrong.push({ text: fx.text, expected: fx.expected, got: task_type });
    }
  }
  assert.ok(
    correct >= 18,
    `expected >=18/20 correct classifications, got ${correct}/20. Wrong: ${JSON.stringify(wrong, null, 2)}`
  );
});

test('parseIntent on empty/whitespace input returns empty + 3 fallback questions', () => {
  for (const empty of ['', '   ', '\t\n']) {
    const intent = parseIntent(empty);
    assert.strictEqual(intent.empty, true);
    assert.strictEqual(intent.task_type, null);
    assert.deepStrictEqual(intent.references, []);
    assert.strictEqual(intent.confident, false);
    assert.strictEqual(intent.fallback_questions.length, 3);
  }
});

test('parseIntent on confident intent returns null fallback_questions', () => {
  const intent = parseIntent('fix WIN-7993 daily bonus auto-claim stuck');
  assert.strictEqual(intent.empty, false);
  assert.strictEqual(intent.task_type, 'bug-fix');
  assert.strictEqual(intent.verb, 'fix');
  assert.strictEqual(intent.references[0].value, 'WIN-7993');
  assert.strictEqual(intent.confident, true);
  assert.strictEqual(intent.fallback_questions, null);
});

test('parseIntent on low-confidence intent returns fallback_questions', () => {
  const intent = parseIntent('hello world');
  assert.strictEqual(intent.empty, false);
  assert.strictEqual(intent.confident, false);
  assert.strictEqual(intent.task_type, 'other');
  assert.ok(Array.isArray(intent.fallback_questions));
  assert.strictEqual(intent.fallback_questions.length, 3);
});

test('parseIntent throws on non-string input', () => {
  assert.throws(() => parseIntent(null), /input must be a string/);
  assert.throws(() => parseIntent(123), /input must be a string/);
  assert.throws(() => parseIntent({}), /input must be a string/);
});
