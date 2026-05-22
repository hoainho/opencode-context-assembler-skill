'use strict';

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const DEFAULT_PROTECTED = ['main', 'master', 'develop', 'release/*', 'hotfix/*', 'production', 'prod'];

const WRITE_VERBS = ['commit', 'push', 'merge'];

function loadProtectedPatterns(repoRoot) {
  const file = path.join(repoRoot, '.opencode', 'protected-branches.yaml');
  if (!fs.existsSync(file)) {
    return [...DEFAULT_PROTECTED];
  }
  let parsed;
  try {
    parsed = yaml.load(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    throw new Error(`loadProtectedPatterns: YAML parse error in ${file}: ${err.message}`);
  }
  if (!parsed || !Array.isArray(parsed.protected_patterns)) {
    throw new Error(`loadProtectedPatterns: expected protected_patterns[] in ${file}`);
  }
  for (const p of parsed.protected_patterns) {
    if (typeof p !== 'string' || p.length === 0) {
      throw new Error(`loadProtectedPatterns: pattern must be non-empty string, got ${JSON.stringify(p)}`);
    }
  }
  return parsed.protected_patterns;
}

function matchesPattern(branch, pattern) {
  if (typeof branch !== 'string' || typeof pattern !== 'string') return false;
  if (!pattern.includes('*')) return branch === pattern;
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  const re = new RegExp(`^${escaped}$`);
  return re.test(branch);
}

function isProtectedBranch(branch, patterns) {
  for (const p of patterns) {
    if (matchesPattern(branch, p)) return true;
  }
  return false;
}

function parseGitCommand(cmd) {
  if (typeof cmd !== 'string') return null;
  const trimmed = cmd.trim();
  const m = trimmed.match(/^git\s+([a-z][a-z-]*)\s*(.*)$/i);
  if (!m) return null;
  const verb = m[1].toLowerCase();
  const rest = m[2] || '';
  return { verb, rest, raw: trimmed };
}

function inspectCommand(cmd) {
  const parsed = parseGitCommand(cmd);
  if (!parsed) return { isGit: false };

  const { verb, rest, raw } = parsed;

  if (verb === 'reset') {
    if (/--hard\b/.test(rest)) {
      return { isGit: true, verb, destructive: true, kind: 'reset-hard', raw };
    }
    return { isGit: true, verb, destructive: false, raw };
  }

  if (verb === 'push') {
    const forcePush = /(?:^|\s)(?:-f|--force|--force-with-lease)(?:\s|$)/.test(rest);
    const branchMatch = rest.match(/(?:^|\s)([a-zA-Z0-9_\-./]+)\s+([a-zA-Z0-9_\-./]+)(?:\s|$)/);
    const refSpec = branchMatch ? branchMatch[2] : null;
    return { isGit: true, verb, destructive: forcePush, kind: 'push', refSpec, forcePush, raw };
  }

  if (verb === 'commit') {
    return { isGit: true, verb, kind: 'commit', destructive: false, raw };
  }

  if (verb === 'merge') {
    return { isGit: true, verb, kind: 'merge', destructive: false, raw };
  }

  return { isGit: true, verb, raw, destructive: false };
}

function checkCommand({ command, currentBranch, repoRoot, override }) {
  if (typeof command !== 'string' || command.length === 0) {
    throw new TypeError('checkCommand: command must be non-empty string');
  }
  if (typeof repoRoot !== 'string' || !path.isAbsolute(repoRoot)) {
    throw new TypeError('checkCommand: repoRoot must be absolute');
  }

  const info = inspectCommand(command);
  if (!info.isGit) {
    return { allowed: true, reason: 'not-a-git-command', info };
  }

  const patterns = loadProtectedPatterns(repoRoot);
  const branch = typeof currentBranch === 'string' ? currentBranch : '';
  const onProtected = isProtectedBranch(branch, patterns);

  if (info.verb === 'reset' && info.kind === 'reset-hard' && onProtected) {
    if (override && override.reason) {
      return { allowed: true, override: true, reason: `override:${override.reason}`, info };
    }
    return {
      allowed: false,
      reason: `BoundaryViolation: reset --hard on protected branch "${branch}"`,
      info,
      patterns_matched: patterns.filter((p) => matchesPattern(branch, p)),
    };
  }

  if (info.verb === 'push' && info.forcePush) {
    return {
      allowed: false,
      reason: `BoundaryViolation: force push (--force / --force-with-lease) is never allowed by git-guard`,
      info,
    };
  }

  if (WRITE_VERBS.includes(info.verb) && onProtected) {
    if (override && override.reason) {
      return { allowed: true, override: true, reason: `override:${override.reason}`, info };
    }
    return {
      allowed: false,
      reason: `BoundaryViolation: ${info.verb} on protected branch "${branch}"`,
      info,
      patterns_matched: patterns.filter((p) => matchesPattern(branch, p)),
    };
  }

  return { allowed: true, info };
}

module.exports = {
  DEFAULT_PROTECTED,
  WRITE_VERBS,
  loadProtectedPatterns,
  matchesPattern,
  isProtectedBranch,
  parseGitCommand,
  inspectCommand,
  checkCommand,
};
