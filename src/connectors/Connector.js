'use strict';

/**
 * Connector public interface — runtime-agnostic.
 *
 * F-3 invariant: connector code MUST NOT import from "opencode/*" or
 * "@opencode/*". All host-runtime bindings live in `src/adapters/`.
 *
 * Three required methods (per source-routing-table.md fork):
 *   - match(task)     -> boolean: does this connector handle this task?
 *   - collect(task)   -> Promise<RawArtifact[]>: fetch raw data
 *   - normalize(raw)  -> ContextItem[]: shape into bundle items
 */
const REQUIRED_METHODS = ['match', 'collect', 'normalize'];

const SOURCE_ENUM = [
  'jira',
  'github',
  'atoms',
  'confluence',
  'sheets',
  'browser-repro',
  'code-context',
  'slack-hybrid',
];

const TASK_TYPES = ['bug-fix', 'feature', 'review', 'design', 'migration', 'other'];

const EVIDENCE_QUALITY_REASONS = [
  'primary-mcp-call',
  'fallback-search',
  'filesystem-grep',
  'no-daemon',
];

function assertConnector(connector) {
  if (!connector || typeof connector !== 'object') {
    throw new TypeError('assertConnector: connector must be an object');
  }
  if (typeof connector.source !== 'string' || !SOURCE_ENUM.includes(connector.source)) {
    throw new TypeError(
      `assertConnector: connector.source must be one of [${SOURCE_ENUM.join(', ')}], got "${connector.source}"`
    );
  }
  for (const method of REQUIRED_METHODS) {
    if (typeof connector[method] !== 'function') {
      throw new TypeError(`assertConnector: connector.${method} must be a function`);
    }
  }
  if (connector.match.length !== 1) {
    throw new TypeError(`assertConnector: match() must accept exactly 1 arg (task), got arity ${connector.match.length}`);
  }
  if (connector.collect.length !== 1) {
    throw new TypeError(`assertConnector: collect() must accept exactly 1 arg (task), got arity ${connector.collect.length}`);
  }
  if (connector.normalize.length !== 1) {
    throw new TypeError(`assertConnector: normalize() must accept exactly 1 arg (raw), got arity ${connector.normalize.length}`);
  }
}

function assertConnectorManifest(manifest) {
  if (!manifest || typeof manifest !== 'object') {
    throw new TypeError('assertConnectorManifest: manifest must be an object');
  }
  const required = ['name', 'source', 'version', 'task_types', 'mcp', 'description'];
  for (const key of required) {
    if (manifest[key] === undefined || manifest[key] === null) {
      throw new TypeError(`assertConnectorManifest: missing required field "${key}"`);
    }
  }
  if (typeof manifest.name !== 'string' || manifest.name.length === 0) {
    throw new TypeError('assertConnectorManifest: name must be non-empty string');
  }
  if (!SOURCE_ENUM.includes(manifest.source)) {
    throw new TypeError(
      `assertConnectorManifest: source must be one of [${SOURCE_ENUM.join(', ')}], got "${manifest.source}"`
    );
  }
  if (typeof manifest.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(manifest.version)) {
    throw new TypeError(`assertConnectorManifest: version must be semver "x.y.z", got "${manifest.version}"`);
  }
  if (!Array.isArray(manifest.task_types) || manifest.task_types.length === 0) {
    throw new TypeError('assertConnectorManifest: task_types must be non-empty array');
  }
  for (const t of manifest.task_types) {
    if (!TASK_TYPES.includes(t)) {
      throw new TypeError(
        `assertConnectorManifest: task_types[] entry "${t}" must be one of [${TASK_TYPES.join(', ')}]`
      );
    }
  }
  if (typeof manifest.mcp !== 'object' || typeof manifest.mcp.primary !== 'string') {
    throw new TypeError('assertConnectorManifest: mcp.primary must be string');
  }
  if (typeof manifest.description !== 'string' || manifest.description.length === 0) {
    throw new TypeError('assertConnectorManifest: description must be non-empty string');
  }
}

module.exports = {
  REQUIRED_METHODS,
  SOURCE_ENUM,
  TASK_TYPES,
  EVIDENCE_QUALITY_REASONS,
  assertConnector,
  assertConnectorManifest,
};
