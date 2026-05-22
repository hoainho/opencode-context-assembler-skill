# Connector Authoring Guide

> Public OSS extension contract for `context-assembler`. Add a new source by writing one YAML manifest + one JS module that implements 3 methods. Zero modifications to core required.

## Overview

A **connector** brings a new external data source into Context Assembler bundles. v1 ships 3 connectors (jira, github, atoms); the architecture supports unlimited additions via:

1. A **manifest** (`connectors/<name>.connector.yaml`) — declarative metadata (source enum, MCP routing, task-types, evidence-quality mapping)
2. An **implementation** (`src/connectors/<name>/{match,collect,normalize}.js`) — 3-method JS module

The loader (`src/connectors/ConnectorLoader.js`) auto-discovers manifests at runtime and validates them against `assertConnectorManifest`.

## The 3-method contract

```js
{
  source: 'jira',                   // enum from SOURCE_ENUM
  match: (task) => boolean,         // does this connector handle this task?
  collect: async (task) => Raw[],   // fetch raw data via MCP
  normalize: (raw) => ContextItem[] // shape into bundle items
}
```

### `match(task) -> boolean`

Decide whether this connector applies to the given task. Pure function over `task.intent` + `task.task_type` + `task.references`. No I/O.

```js
function match(task) {
  if (task.task_type === 'design' || task.task_type === 'migration') return false;
  return task.references.some(ref => /^WIN-\d+$/.test(ref));
}
```

### `collect(task) -> Promise<RawArtifact[]>`

Fetch raw data from external sources via MCP tools. **No transformation** — return whatever the MCP returned, plus provenance metadata (mcp_used, query_issued, fetched_at).

The collect function MUST:
- Honor `evidence_quality` per `source-routing-table.md`: try primary → empty fallback → emit gap (NOT silent retry)
- Capture `mcp_used` + canonical-JSON `query_issued` for replay determinism
- Tag `evidence_quality_reason` from the frozen 4-value enum
- Throw NEVER for "MCP unavailable" — emit a gap entry instead

### `normalize(raw) -> ContextItem[]`

Shape raw artifacts into `ContextBundleItem[]` matching `schemas/v1.0.0/context-bundle-item.schema.json`. **Pure** — no I/O. Must produce bundle items that schema-validate.

## Manifest schema

```yaml
name: jira-connector              # required, non-empty string
source: jira                      # required, enum (see SOURCE_ENUM)
version: 1.0.0                    # required, semver "x.y.z"
description: |                    # required
  Human-readable purpose
task_types:                       # required, non-empty array; entries from TASK_TYPES
  - bug-fix
  - feature
  - review
mcp:                              # required object
  primary: jira_jira_issues       # required string — primary MCP tool
  empty_fallback: jira_jira_search          # optional string
  unavailable_fallback: gap-emit            # optional string
query_template:                   # optional object — string templates for canonical JSON args
  primary: '{ "action": "get", "issueKey": "{ticket_id}" }'
timeout_ms: 10000                 # optional integer; default 10000
rate_limit_per_minute: 30         # optional integer; default per-host bucket
evidence_quality:                 # optional object — overrides defaults
  primary: verified
  empty_fallback: degraded
```

See `connectors/_template.connector.yaml` for a working starting point. Files prefixed with `_` are skipped by the loader (treated as templates).

## F-3 invariant: runtime-agnostic code

**Connector code MUST NOT import from `opencode/*` or `@opencode/*`.** All host-runtime bindings live in `src/adapters/`. This is enforced by:

1. The `checkRuntimeAgnostic(srcDir)` static check (in `ConnectorLoader.js`)
2. A regression test (`F-3` per `references/regression-fixtures.md`) that runs in CI

If your connector needs a host-runtime feature (e.g., reading user-config files, invoking shell commands), get the binding from the adapter layer, not directly. This is what makes context-assembler portable across opencode versions and across multiple host runtimes (Cursor, Continue, etc. — post-v1).

## Failure-mode contract

Per the regression suite (`F-1` Continue silent-fail, `F-4` Aider hallucinated source, `F-5` Cursor no-audit):

- **Connector unavailable / auth fail / rate-limited** → emit gap with structured reason; never return empty silently
- **Hallucinated/unresolvable URI** → validate URI before adding to items[]; unresolvable URIs go to gaps[] not items[]
- **Every external call** → audit-logged via the audit middleware (PR 7+); your collect() does not need to audit explicitly, but it MUST use the MCP-call wrapper

## Acceptance criteria for new connector PRs

When contributing a new connector:

1. Manifest validates via `assertConnectorManifest` (run `npm run test:connector-loader` on your manifest)
2. Implementation validates via `assertConnector` (3 methods, correct arity)
3. `checkRuntimeAgnostic` returns 0 violations across the new code
4. Unit tests cover: `match` returns expected booleans for ≥5 fixture tasks, `collect` mocks MCP layer and asserts correct calls + gap emission on errors, `normalize` produces schema-valid items
5. Add a row to `references/source-routing-table.md` documenting the connector's behavior

## Reference v1 connectors

| Connector | Manifest | PR |
|---|---|---|
| jira | `connectors/jira.connector.yaml` | PR 10 |
| github | `connectors/github.connector.yaml` | PR 11 |
| atoms | `connectors/atoms.connector.yaml` | PR 12 |

## Deferred for v2+

- confluence, sheets, browser-repro, code-context, slack-hybrid

See `references/source-routing-table.md` for the full v1 + v2 routing matrix.
