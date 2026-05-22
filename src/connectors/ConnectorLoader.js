'use strict';

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { assertConnectorManifest } = require('./Connector');

const FORBIDDEN_IMPORT_RE = /(?:require\s*\(|from\s+|import\s*\()\s*(['"])(@?opencode(?:\/[^'"]*)?)\1/;

function stripJsComments(source) {
  let out = '';
  let i = 0;
  const n = source.length;
  let inSingle = false;
  let inDouble = false;
  let inBacktick = false;
  let inLineComment = false;
  let inBlockComment = false;
  while (i < n) {
    const ch = source[i];
    const next = source[i + 1];
    if (inLineComment) {
      if (ch === '\n') {
        inLineComment = false;
        out += ch;
      }
      i++;
      continue;
    }
    if (inBlockComment) {
      if (ch === '*' && next === '/') {
        inBlockComment = false;
        i += 2;
        continue;
      }
      if (ch === '\n') out += ch;
      i++;
      continue;
    }
    if (inSingle) {
      if (ch === '\\' && next !== undefined) {
        out += ch + next;
        i += 2;
        continue;
      }
      if (ch === "'") inSingle = false;
      out += ch;
      i++;
      continue;
    }
    if (inDouble) {
      if (ch === '\\' && next !== undefined) {
        out += ch + next;
        i += 2;
        continue;
      }
      if (ch === '"') inDouble = false;
      out += ch;
      i++;
      continue;
    }
    if (inBacktick) {
      if (ch === '\\' && next !== undefined) {
        out += ch + next;
        i += 2;
        continue;
      }
      if (ch === '`') inBacktick = false;
      out += ch;
      i++;
      continue;
    }
    if (ch === '/' && next === '/') {
      inLineComment = true;
      i += 2;
      continue;
    }
    if (ch === '/' && next === '*') {
      inBlockComment = true;
      i += 2;
      continue;
    }
    if (ch === "'") inSingle = true;
    else if (ch === '"') inDouble = true;
    else if (ch === '`') inBacktick = true;
    out += ch;
    i++;
  }
  return out;
}

function loadManifestFile(filePath) {
  if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) {
    throw new TypeError(`loadManifestFile: filePath must be absolute string, got "${filePath}"`);
  }
  if (!fs.existsSync(filePath)) {
    throw new Error(`loadManifestFile: file not found: ${filePath}`);
  }
  const raw = fs.readFileSync(filePath, 'utf8');
  let parsed;
  try {
    parsed = yaml.load(raw, { schema: yaml.FAILSAFE_SCHEMA, json: false });
  } catch (err) {
    throw new Error(`loadManifestFile: YAML parse error in ${filePath}: ${err.message}`);
  }
  if (parsed === undefined || parsed === null) {
    throw new Error(`loadManifestFile: empty manifest at ${filePath}`);
  }
  try {
    assertConnectorManifest(parsed);
  } catch (err) {
    throw new Error(`loadManifestFile: invalid manifest at ${filePath}: ${err.message}`);
  }
  return parsed;
}

function loadAllManifests(connectorsDir) {
  if (typeof connectorsDir !== 'string' || !path.isAbsolute(connectorsDir)) {
    throw new TypeError(`loadAllManifests: connectorsDir must be absolute, got "${connectorsDir}"`);
  }
  if (!fs.existsSync(connectorsDir)) {
    throw new Error(`loadAllManifests: directory not found: ${connectorsDir}`);
  }
  const stat = fs.statSync(connectorsDir);
  if (!stat.isDirectory()) {
    throw new Error(`loadAllManifests: not a directory: ${connectorsDir}`);
  }

  const files = fs.readdirSync(connectorsDir, { withFileTypes: true });
  const manifests = [];
  const sourcesSeen = new Map();

  for (const entry of files) {
    if (!entry.isFile()) continue;
    if (!entry.name.endsWith('.connector.yaml')) continue;
    if (entry.name.startsWith('_')) continue;
    const full = path.join(connectorsDir, entry.name);
    const manifest = loadManifestFile(full);
    if (sourcesSeen.has(manifest.source)) {
      throw new Error(
        `loadAllManifests: duplicate source "${manifest.source}" in ${entry.name} (already declared in ${sourcesSeen.get(manifest.source)})`
      );
    }
    sourcesSeen.set(manifest.source, entry.name);
    manifests.push({ filename: entry.name, manifest });
  }

  return manifests;
}

function checkRuntimeAgnostic(srcDir) {
  if (typeof srcDir !== 'string' || !path.isAbsolute(srcDir)) {
    throw new TypeError(`checkRuntimeAgnostic: srcDir must be absolute, got "${srcDir}"`);
  }
  if (!fs.existsSync(srcDir)) {
    throw new Error(`checkRuntimeAgnostic: directory not found: ${srcDir}`);
  }

  const violations = [];

  function walk(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && /\.(?:js|mjs|cjs|ts)$/.test(entry.name)) {
        const content = fs.readFileSync(full, 'utf8');
        const stripped = stripJsComments(content);
        const lines = stripped.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (FORBIDDEN_IMPORT_RE.test(lines[i])) {
            violations.push({ file: full, line: i + 1, snippet: lines[i].trim() });
          }
        }
      }
    }
  }

  walk(srcDir);
  return violations;
}

module.exports = {
  FORBIDDEN_IMPORT_RE,
  stripJsComments,
  loadManifestFile,
  loadAllManifests,
  checkRuntimeAgnostic,
};
