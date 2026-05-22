#!/usr/bin/env node
'use strict';

const path = require('path');
const { replayBundle } = require('../src/audit/replay');

function parseArgs(argv) {
  const out = { mode: 'no-fetch', repoRoot: process.cwd() };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--no-fetch') out.mode = 'no-fetch';
    else if (arg === '--live') out.mode = 'live';
    else if (arg === '--repo' && argv[i + 1]) {
      out.repoRoot = path.resolve(argv[++i]);
    } else if (arg === '--date' && argv[i + 1]) {
      out.dateIso = argv[++i];
    } else if (arg.startsWith('--')) {
      console.error(`unknown flag: ${arg}`);
      process.exit(2);
    } else if (!out.bundleId) {
      out.bundleId = arg;
    } else {
      console.error(`unexpected positional: ${arg}`);
      process.exit(2);
    }
  }
  return out;
}

function usage() {
  console.error('usage: context-assembler-replay <bundle-id> --date YYYY-MM-DD [--no-fetch|--live] [--repo <path>]');
  process.exit(2);
}

function main(argv) {
  const args = parseArgs(argv);
  if (!args.bundleId) usage();
  if (!args.dateIso) usage();
  try {
    const result = replayBundle({
      repoRoot: args.repoRoot,
      bundleId: args.bundleId,
      dateIso: args.dateIso,
      mode: args.mode,
    });
    process.stdout.write(JSON.stringify(result) + '\n');
    process.exit(0);
  } catch (err) {
    process.stderr.write(`replay error: ${err.message}\n`);
    process.exit(1);
  }
}

if (require.main === module) {
  main(process.argv.slice(2));
}

module.exports = { parseArgs, main };
