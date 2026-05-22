'use strict';

const { TASK_TYPES } = require('../connectors/Connector');

const TICKET_RE = /\b([A-Z][A-Z0-9]{1,9})-(\d{1,6})\b/g;
const PR_RE = /(?:^|\s|\()#(\d{1,7})\b/g;
const URL_RE = /\bhttps?:\/\/[^\s<>")\]]+/g;
const MENTION_RE = /(?:^|\s)@([a-zA-Z0-9._-]{2,40})\b/g;

const VERB_KEYWORDS = {
  'bug-fix': [
    'fix', 'debug', 'bug', 'broken', 'crash', 'crashes', 'crashing',
    'error', 'errors', 'failing', 'fails', 'failure',
    'investigate', 'why is', 'why does', 'why are', 'regression',
    'flaky', 'stuck', 'hang', 'hangs', 'hanging', 'stale',
    'leak', 'race', 'deadlock', 'panic', 'segfault', 'oom',
    'incident', 'hotfix', 'rollback',
  ],
  feature: [
    'implement', 'add', 'build', 'create', 'introduce', 'support',
    'enable', 'develop', 'ship', 'launch', 'rollout',
    'new feature', 'epic', 'story',
  ],
  review: [
    'review', 'pr review', 'code review', 'audit pr',
    'approve pr', 'check pr', 'evaluate pr',
  ],
  design: [
    'design', 'architect', 'architecture', 'spec out', 'spike',
    'rethink', 'redesign', 'evaluate options', 'tradeoff',
    'proposal', 'rfc', 'scope out',
  ],
  migration: [
    'migrate', 'migration', 'refactor to use', 'switch to',
    'port to', 'upgrade to', 'replace with', 'move from',
    'convert from', 'rewrite to',
  ],
};

const FALLBACK_QUESTIONS = Object.freeze([
  'What is the task? (verb + object — e.g., "fix WIN-7993" or "implement leaderboard refresh")',
  'Which references should be collected? (Jira tickets, PR numbers, URLs, file paths)',
  'How recent should the context be? (e.g., "last 7 days", "since sprint 80 start", "all-time")',
]);

function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^\w\s-]+/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 0);
}

function findMatchesGlobal(re, text) {
  const out = [];
  re.lastIndex = 0;
  let m;
  while ((m = re.exec(text)) !== null) {
    out.push(m);
  }
  return out;
}

function extractReferences(text) {
  const refs = [];
  const seen = new Set();
  for (const m of findMatchesGlobal(TICKET_RE, text)) {
    const key = `ticket:${m[1]}-${m[2]}`;
    if (!seen.has(key)) {
      seen.add(key);
      refs.push({ kind: 'ticket', value: `${m[1]}-${m[2]}`, project: m[1], number: Number(m[2]) });
    }
  }
  for (const m of findMatchesGlobal(PR_RE, text)) {
    const key = `pr:${m[1]}`;
    if (!seen.has(key)) {
      seen.add(key);
      refs.push({ kind: 'pr', value: `#${m[1]}`, number: Number(m[1]) });
    }
  }
  for (const m of findMatchesGlobal(URL_RE, text)) {
    const key = `url:${m[0]}`;
    if (!seen.has(key)) {
      seen.add(key);
      refs.push({ kind: 'url', value: m[0] });
    }
  }
  for (const m of findMatchesGlobal(MENTION_RE, text)) {
    const key = `mention:${m[1]}`;
    if (!seen.has(key)) {
      seen.add(key);
      refs.push({ kind: 'mention', value: `@${m[1]}`, handle: m[1] });
    }
  }
  return refs;
}

function detectVerb(text) {
  const lc = String(text || '').toLowerCase();
  for (const word of ['fix', 'implement', 'add', 'review', 'design', 'migrate', 'refactor', 'investigate', 'debug', 'build']) {
    const re = new RegExp(`(?:^|\\s)${word}(?:\\s|$)`);
    if (re.test(lc)) return word;
  }
  return null;
}

const SCOPE_WINDOW_RE_LIST = [
  { re: /\b(last|past)\s+(\d+)\s+(day|days|week|weeks|month|months|sprint|sprints)\b/i, kind: 'relative' },
  { re: /\bsince\s+sprint\s+(\d+)\b/i, kind: 'sprint-start' },
  { re: /\bsince\s+(\d{4}-\d{2}-\d{2})\b/i, kind: 'absolute' },
  { re: /\bthis\s+(week|sprint|month)\b/i, kind: 'this-period' },
  { re: /\ball[-\s]?time\b/i, kind: 'all-time' },
];

function detectScopeWindow(text) {
  for (const { re, kind } of SCOPE_WINDOW_RE_LIST) {
    const m = text.match(re);
    if (m) {
      return { kind, raw: m[0] };
    }
  }
  return null;
}

function classifyTaskType(text) {
  const lc = String(text || '').toLowerCase();
  const scores = Object.create(null);
  for (const t of TASK_TYPES) scores[t] = 0;

  for (const [type, keywords] of Object.entries(VERB_KEYWORDS)) {
    for (const kw of keywords) {
      if (kw.includes(' ')) {
        if (lc.includes(kw)) scores[type] += 2;
      } else {
        const re = new RegExp(`(?:^|\\W)${kw}(?:\\W|$)`);
        if (re.test(lc)) scores[type] += 1;
      }
    }
  }

  if (/\b(?:WIN|PROJ|JIRA|[A-Z]{2,5})-\d+\b/i.test(text) && /\b(fix|bug|debug|investigate|why)\b/i.test(lc)) {
    scores['bug-fix'] += 1;
  }

  let best = 'other';
  let bestScore = 0;
  for (const [type, score] of Object.entries(scores)) {
    if (score > bestScore) {
      best = type;
      bestScore = score;
    }
  }
  return { task_type: best, scores, confident: bestScore >= 2 };
}

function parseIntent(text) {
  if (typeof text !== 'string') {
    throw new TypeError('parseIntent: input must be a string');
  }
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return {
      raw: text,
      empty: true,
      task_type: null,
      verb: null,
      references: [],
      scope_window: null,
      confident: false,
      fallback_questions: [...FALLBACK_QUESTIONS],
    };
  }

  const refs = extractReferences(trimmed);
  const verb = detectVerb(trimmed);
  const scope = detectScopeWindow(trimmed);
  const { task_type, scores, confident } = classifyTaskType(trimmed);

  return {
    raw: text,
    empty: false,
    task_type,
    verb,
    references: refs,
    scope_window: scope,
    confident,
    classifier_scores: scores,
    fallback_questions: confident ? null : [...FALLBACK_QUESTIONS],
  };
}

module.exports = {
  TICKET_RE,
  PR_RE,
  URL_RE,
  MENTION_RE,
  FALLBACK_QUESTIONS,
  tokenize,
  extractReferences,
  detectVerb,
  detectScopeWindow,
  classifyTaskType,
  parseIntent,
};
