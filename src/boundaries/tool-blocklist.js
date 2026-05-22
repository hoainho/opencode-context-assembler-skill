'use strict';

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const DEFAULT_PATTERNS = [
  String.raw`rm\s+-rf\s+/`,
  String.raw`rm\s+-rf\s+~`,
  String.raw`rm\s+-rf\s+\*`,
  String.raw`DROP\s+TABLE\b`,
  String.raw`DROP\s+DATABASE\b`,
  String.raw`TRUNCATE\s+TABLE\b`,
  String.raw`TRUNCATE\s+DATABASE\b`,
  String.raw`DELETE\s+FROM\s+\w+\s*;`,
  String.raw`git\s+push\s+(-f|--force|--force-with-lease)\b`,
  String.raw`git\s+reset\s+--hard\s+origin`,
  String.raw`git\s+filter-branch\b`,
  String.raw`git\s+update-ref\s+-d\b`,
  String.raw`>\s*/dev/sd[a-z]`,
  String.raw`mkfs\b`,
  String.raw`dd\s+if=.*of=/dev/`,
  String.raw`chmod\s+-R\s+777\s+/`,
  String.raw`:\(\)\{\s*:\|:&\s*\};:`,
];

function loadBlocklist(repoRoot) {
  if (typeof repoRoot !== 'string' || !path.isAbsolute(repoRoot)) {
    throw new TypeError('loadBlocklist: repoRoot must be absolute');
  }
  const file = path.join(repoRoot, '.opencode', 'tool-blocklist.yaml');
  if (!fs.existsSync(file)) {
    return [...DEFAULT_PATTERNS];
  }
  let parsed;
  try {
    parsed = yaml.load(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    throw new Error(`loadBlocklist: YAML parse error in ${file}: ${err.message}`);
  }
  if (!parsed || !Array.isArray(parsed.blocklist)) {
    throw new Error(`loadBlocklist: expected blocklist[] in ${file}`);
  }
  for (const p of parsed.blocklist) {
    if (typeof p !== 'string' || p.length === 0) {
      throw new Error(`loadBlocklist: pattern must be non-empty string, got ${JSON.stringify(p)}`);
    }
  }
  return parsed.blocklist;
}

function compilePatterns(patterns) {
  return patterns.map((src) => {
    try {
      return { source: src, regex: new RegExp(src, 'i') };
    } catch (err) {
      throw new Error(`compilePatterns: invalid regex "${src}": ${err.message}`);
    }
  });
}

function isDestructive({ command, repoRoot, patterns }) {
  if (typeof command !== 'string' || command.length === 0) {
    throw new TypeError('isDestructive: command must be non-empty string');
  }
  const compiled = patterns
    ? compilePatterns(Array.isArray(patterns) ? patterns : [])
    : compilePatterns(loadBlocklist(repoRoot));

  for (const { source, regex } of compiled) {
    if (regex.test(command)) {
      return { destructive: true, matched_pattern: source };
    }
  }
  return { destructive: false };
}

function checkCommand({ command, repoRoot }) {
  const result = isDestructive({ command, repoRoot });
  if (result.destructive) {
    return {
      allowed: false,
      reason: `BoundaryViolation: command matches destructive pattern "${result.matched_pattern}"; no override path`,
      matched_pattern: result.matched_pattern,
    };
  }
  return { allowed: true };
}

module.exports = {
  DEFAULT_PATTERNS,
  loadBlocklist,
  compilePatterns,
  isDestructive,
  checkCommand,
};
