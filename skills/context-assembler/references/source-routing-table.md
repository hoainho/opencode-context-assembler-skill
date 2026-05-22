# Source Routing Table

> **Forked from**: `diagnostic-driven-debugging/references/mcp-routing-table.md` (R1 Explore identified as the cleanest connector abstraction in the opencode skill ecosystem)
>
> **Pattern**: For each task-type × source pair, declare primary MCP, fallback when primary returns empty, and unavailable-fallback when MCP is down. Each row carries an `evidence_quality` flag so consumers know when context is degraded.

---

## How this table is used

1. **Phase 0 (Frame)** classifies the task into a `task_type` (one of 6 enum values).
2. **Phase 1 (Discover)** consults this table to determine which connectors fire for this task type.
3. **Phase 2 (Collect)** invokes each connector with the per-row primary MCP. On `empty` result → fallback. On MCP unavailable → unavailable-fallback (which may produce a `gap` entry rather than data).
4. **Phase 3 (Synthesize)** preserves `evidence_quality` per item; bundle review surfaces "X items with degraded evidence" for user awareness.

**Source-priority rule (locked in plan Section 0 #1)**: When two sources contradict, surface BOTH side-by-side with `conflict_marker: true`. The skill never picks a winner.

---

## Task types (6)

| Task type | Trigger phrases (examples) | Typical sources |
|---|---|---|
| `bug-fix` | "fix WIN-XXXX", "debug ...", "why is X broken" | Jira + GitHub PRs + atoms + (v2) browser-repro + console-hub |
| `feature` | "implement X", "add Y feature", "build Z" | Jira epic + (v2) Confluence + GitHub PR history + atoms |
| `review` | "review PR #N", "code-review this" | GitHub PR + Jira linked tickets + atoms |
| `design` | "design system for X", "architecture for Y" | (v2) Confluence + atoms + (v2) Figma |
| `migration` | "migrate from X to Y", "refactor Z to use Q" | atoms + GitHub PR history + (v2) Confluence + (v2) Sheets |
| `other` | (catchall) | atoms + Jira (if reference) + GitHub (if reference) |

---

## Routing table — v1 connectors

### bug-fix

| Source | Primary MCP + tool | Empty fallback | Unavailable fallback | Evidence quality |
|---|---|---|---|---|
| **jira** | `jira_jira_issues` action=`get` (then `jira_jira_comments` action=`get`, then `jira_jira_links` action=`list`) | If ticket has 0 linked PRs → query `jira_jira_search` with `project = WIN AND text ~ "<intent_keywords>"` | Emit gap: `{expected: "<ticket_id>", reason: "jira MCP unavailable"}` | `verified` (primary) / `degraded` (search-fallback) |
| **github** | `github_search_code` with intent keywords scoped to playsweeps-* repos + `github_list_commits` filtered by referenced files | If 0 hits → expand to last 30d commits across linked repos | Emit gap: `{expected: "github recent activity for <area>", reason: "github MCP unavailable"}` | `verified` / `degraded` |
| **atoms** | `omo-session-distiller_recall` with intent keywords + repo filter | If max_score < 80 → expand to repo=any | If recall MCP down → fallback to filesystem-grep on `~/.config/opencode/memory/atoms/` | `verified` (atom recall) / `degraded` (grep) / `partial` (no daemon) |

### feature

| Source | Primary MCP + tool | Empty fallback | Unavailable fallback | Evidence quality |
|---|---|---|---|---|
| **jira** | `jira_jira_issues` action=`get` (epic + child stories via `jira_jira_search`) | Search for keywords in `description` and `acceptance criteria` custom field | Emit gap | `verified` / `degraded` |
| **github** | `github_list_pull_requests` filtered by epic-key in title/body, last 90d | Expand to repo-wide PRs touching feature-area files (if discoverable from epic) | Emit gap | `verified` / `degraded` |
| **atoms** | `omo-session-distiller_recall` with feature-name + repo | If max_score < 60 → expand to related-feature keywords | filesystem-grep | `verified` / `degraded` / `partial` |

### review

| Source | Primary MCP + tool | Empty fallback | Unavailable fallback | Evidence quality |
|---|---|---|---|---|
| **github** | `github_get_pull_request` + `github_get_pull_request_files` + `github_get_pull_request_reviews` | (always non-empty for valid PR) | Emit gap (PR review without GitHub MCP is non-functional) | `verified` / N/A |
| **jira** | `jira_jira_links` to find tickets linked from PR description (regex `WIN-\d+` in PR body) | None — if PR has no Jira ref, skip | Emit gap | `verified` / `degraded` |
| **atoms** | `omo-session-distiller_recall` for past reviews on same files/areas (touched_paths filter) | Reduce to repo-only filter | filesystem-grep | `verified` / `degraded` / `partial` |

### design / migration / other

Templates for these task types are deferred to v2 — v1 routing table covers the 3 highest-frequency task types in user's playsweeps workflow (bug-fix dominant per AGENTS.md sprint mix). Migration and design tasks fall back to `other` routing in v1: atoms + jira + github (when references present).

---

## Routing table — deferred connectors (v2+)

| Connector | Primary MCP | Status |
|---|---|---|
| **confluence** | `confluence_conf_get`, `confluence_conf_search` (CQL) | Stage 5 |
| **sheets** | `google-drive_gsheets_read`, `google-drive_gdrive_search` | Stage 5 |
| **browser-repro** | `playwright_browser_*`, `chrome-devtools_*` | Stage 5 |
| **code-context** | `ast-grep` + `lsp_symbols` + `grep` | Stage 5 |
| **slack-hybrid** | `webfetch` on permalink + user-paste UX | Stage 5 |

**No Slack MCP exists at v1 ship time.** R4-locked strategy: v1 ships placeholder gap entry for Slack; Stage 5 introduces hybrid (webfetch on Slack permalink URLs + user-paste form for permalink-not-resolvable cases).

---

## Provenance metadata per item

Every collected `ContextBundleItem` MUST carry:

```json
{
  "source": "jira",                    // which connector produced it
  "source_ref": "WIN-7102",            // which entity in source
  "fetched_at": "2026-05-22T08:14:00Z",
  "evidence_quality": "verified" | "degraded" | "partial",
  "evidence_quality_reason": "primary-mcp-call" | "fallback-search" | "filesystem-grep" | "no-daemon",
  "mcp_used": "jira_jira_issues",
  "query_issued": "{action: 'get', issueKey: 'WIN-7102'}"
}
```

**Why this matters**: Replay determinism (PR 7) requires the exact `mcp_used + query_issued` to reproduce. Without provenance, replay degrades silently.

---

## Reference: previous-art justification

R1 Librarian found that **no existing AI-coding tool** offers a per-task-type source routing table:
- Continue.dev: per-prompt @-mentions, no task-type concept
- Cursor: @-mentions inline, no taxonomy
- Aider: file-only context, no task-type
- Claude Code: ad-hoc agent-decided, no declarative routing
- Cline / Roo: per-action tool calls, no upfront source-set

R1 Explore confirmed the diagnostic-driven-debugging routing table is the cleanest pattern in this opencode codebase. This file forks that pattern for context-assembler with task-type added as the primary key.
