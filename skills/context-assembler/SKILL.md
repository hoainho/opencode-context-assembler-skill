---
name: context-assembler
version: 0.0.0
description: Pre-task artifact producer. Collects multi-source context (Jira+GitHub+atoms in v1) into user-reviewed immutable bundle before any AI task runs. Zero autonomy, 5 hard permission boundaries, replayable audit log.
trigger_phrases:
  - assemble context bundle for
  - gather context for
  - prep ticket
---

# Context Assembler

## One-line spec

**The pre-task artifact producer.** When user gives a task, this skill auto-collects multi-source context (Jira + GitHub + past atoms in v1) into an immutable user-reviewed bundle, then hands off to a downstream consumer skill or returns bundle for direct user use.

Collection is automated. **Execution is not.**

---

## Anti-vision — 8 things this skill will NEVER do

1. **NO autonomous task decomposition** — skill never decides what tasks to do
2. **NO auto-execute after assembly** — mandatory user review gate before handoff
3. **NO smart source selection** — sources explicit per task-type, not LLM-inferred
4. **NO proactive polling** — only user-triggered, no background watch
5. **NO cross-task synthesis** — bundle for task A never auto-influences task B
6. **NO write-back to sources** — read-only audit-proven; no posting to Slack/Jira/Sheets
7. **NO LLM-generated narrative in v1** — raw quotes with citations only (eliminates hallucination class)
   - **Note**: Structural ops allowed (dedup, score, rank via deterministic functions). Not "no compute" — only "no narrative generation."
8. **NO embedding service in v1** — relevance scoring uses deterministic content-hash + keyword-overlap + recency-decay. NO OpenAI embeddings, NO sentence-transformers, NO live LLM. Determinism is FREE, not engineered.

---

## 5 Permission boundaries (middleware-enforced, NOT convention)

### Boundary 1: Write boundary
- **Mechanism**: `git-guard` middleware parses every bash command before exec
- **Enforcement**: Reject `git commit/push/merge/reset --hard` on protected branches (main, master, develop, release/*, hotfix/*)
- **Override**: `--override-write-boundary --reason="..."` flag (audited)

### Boundary 2: Artifact cap
- **Mechanism**: `.opencode/.cap-ledger.ndjson` append-only HMAC-signed counter
- **Enforcement**: ≤5 auto-bundles/day (kind=auto); user-initiated bundles uncounted (kind=user-initiated)
- **Override**: None (intentional)
- **Tamper detection**: HMAC verification on every read

### Boundary 3: Surface boundary
- **Mechanism**: Write-surface MCP tool allowlist + per-call `APPROVE SEND` prompt
- **Enforcement**: Jira/Confluence/Slack write tools require literal `APPROVE SEND` typed by user; no batching
- **Override**: None (designed friction)

### Boundary 4: Audit boundary
- **Mechanism**: Every external call → `.opencode/audit/<date>/<bundle_id>.ndjson` with `{ts, actor, phase, action, args, result_hash, duration_ms}`
- **Result body**: Cached at `.opencode/audit/<date>/results/<sha256>.json`
- **Replay**: `context-assembler replay <bundle_id>` reproduces bundle deterministically
- **Determinism guarantee**: ≥99% replay-identical hash on fixture corpus

### Boundary 5: Tool boundary
- **Mechanism**: Static regex blocklist matched against bash commands
- **Enforcement**: Reject `rm -rf`, `DROP TABLE`, `git push --force`, etc.
- **Override**: None — invoke destructive tools outside the skill
- **Default blocklist**: `.opencode/tool-blocklist.yaml` (user-extensible)

---

## Phase model

| Phase | Name | Output | User Gate |
|---|---|---|---|
| 0 | **Frame** | `task.intent.json` | Confirm intent before any external calls |
| 1 | **Discover** | `sources.manifest.json` (connectors + atom-first recall) | Disable any connector |
| 1.5 | **Recall short-circuit** | If atom recall ≥80 confidence, prompt "atoms may have answer, still query external?" | Decide external collection |
| 2 | **Collect** | Per-source `bundle.raw/` artifacts + audit entries | None (rate-limited fetch) |
| 3 | **Synthesize** | `bundle.context.md` + `bundle.context.json` + `bundle.gaps.md` + `bundle.lock.json` (SHA-256) | **MANDATORY non-skippable review** (fast-path UX) |
| 4 | **Handoff** | Invoke target skill via sidecar wrapper OR return bundle path | Pick consumer |

**Fast-path review UX**: 5-line summary + single-keystroke approve(a) / edit(e) / reject(r). Mitigates approval-fatigue.

**Rubber-stamp contingency**: If rolling 20-bundle window shows >90% no-edit rate, fast-path is auto-disabled for next 10 bundles (forced full review). Re-enables when edit-rate recovers to ≥10%. See [`references/rubber-stamp-throttle.md`](references/rubber-stamp-throttle.md) (Stage 1 PR 7).

---

## Bundle artifact schema

Adopts **MCP Resource schema as base** (modelcontextprotocol.io/specification) + Continue's `ContextItem.content` field + minimal assembler extensions.

```typescript
// schema_version: "1.0.0"
interface ContextBundleItem {
  // MCP Resource fields
  uri: string;            // e.g., "jira://WIN-7102", "github://playsweeps-web/pull/4821"
  name: string;
  title?: string;
  description?: string;
  mimeType?: string;
  annotations?: {
    audience?: ("user" | "assistant")[];
    priority?: number;      // 0.0-1.0
    lastModified?: string;  // ISO 8601
  }
  // Continue.dev field
  content: string;          // Text injected into downstream LLM
  // Assembler extensions
  source: string;
  fetched_at: string;
  fetched_by: string;
  approved: boolean;
  relevance_score: number;
  relevance_reason: string;
  conflict_marker?: boolean;
  extensions: Record<string, unknown>;
}

interface ContextBundle {
  schema_version: "1.0.0";
  bundle_id: string;        // ULID
  task_intent: string;
  task_type: "bug-fix" | "feature" | "review" | "design" | "migration" | "other";
  created_at: string;
  created_by: string;
  items: ContextBundleItem[];
  gaps: Array<{expected: string; reason: string}>;
  audit_log_ref: string;
  status: "framing" | "discovering" | "collecting" | "review-pending" | "approved" | "consumed" | "expired";
  hash: string;             // SHA-256 of canonical JSON of items[]
  cost_tokens: number;
  cost_budget: 12000;       // Locked default
  scoring_strategy: "content-hash-v1"; // Forward-compat
}
```

**Determinism invariant**: Relevance scoring formula is content-hash + keyword-overlap + recency-decay. No live LLM. No embedding service in v1.

```typescript
function relevance_score(item, intent): number {
  const intent_tokens = tokenize_normalized(intent.text);
  const item_tokens   = tokenize_normalized(item.content);
  const overlap       = jaccard(intent_tokens, item_tokens);
  const recency       = Math.exp(-age_days(item.fetched_at) / 30);
  const explicit_ref  = item.uri.includes(intent.ticket_id) ? 0.3 : 0;
  return clamp(0.5*overlap + 0.3*recency + 0.2*explicit_ref, 0, 1);
}
```

---

## v1 Connectors (3 total)

| Connector | MCP | Status |
|---|---|---|
| jira | `jira_*` | v1 |
| github | `github_*` | v1 |
| atoms | `omo-session-distiller_*` (recall) | v1 |

**Deferred to post-v1**: confluence, sheets, browser-repro, code-context, slack-hybrid (webfetch + user-paste UX, not "wait for MCP")

---

## Composition via sidecar wrappers (zero modification to upstream skills)

Context Assembler is **upstream infrastructure**. Downstream skills consume bundles via sidecar wrapper scripts that set `OPENCODE_CONTEXT_BUNDLE` env var, then invoke unmodified upstream skill.

```bash
# bin/cba-wrap-ddd.sh
export OPENCODE_CONTEXT_BUNDLE="$BUNDLE_PATH"
exec opencode skill diagnostic-driven-debugging "$@"
```

Consumer skills opt-in via 3-line env-var read in their Phase 0. Skills without integration simply ignore the env var (backward compatible).

**v1 consumers**:
- diagnostic-driven-debugging (PR 17 — pilot)
- deep-design (PR 18 — highest leverage, Metis/Oracle subagents)
- pr-code-reviewer (PR 19 — 4 parallel subagents)
- subagent-driven-development (PR 20 — implementer.md injection)
- review-work (PR 21 — 5 parallel context-mining subagents)

**Deferred**: comprehensive-feature-builder (speculative integration; post-v1)

---

## PRODUCTION-READY criteria (composite, all 4 must pass)

| Metric | Threshold | Per-category floor |
|---|---|---|
| First-Pass Bundle Acceptance Rate (FPBAR) | ≥80% | ≥70% |
| Replay determinism (audit → identical hash) | ≥99% | N/A |
| Bundle coverage rate (% items downstream uses) | ≥30% | N/A |
| Time-to-handoff median | ≤5min cold / ≤90s recall-hit | N/A |

20% of pilot corpus dual-rated by senior peer (defeats Hawthorne effect).

---

## Storage layout

```
.opencode/context-bundles/
├── <bundle_id>/                  # ULID-named
│   ├── bundle.context.md         # Human-readable digest
│   ├── bundle.context.json       # Machine-consumable
│   ├── bundle.lock.json          # Immutable SHA-256-hashed snapshot
│   ├── bundle.gaps.md            # What couldn't be collected
│   ├── raw/                      # Per-source raw artifacts
│   └── audit.ndjson              # Local audit trail
├── .cap-ledger.ndjson            # HMAC-signed counter
└── .index.json                   # task_intent → bundle_id

.opencode/audit/<YYYY-MM-DD>/
├── results/<sha256>.json         # Cached MCP responses
└── <bundle_id>.ndjson
```

All gitignored by default (privacy: bundles may contain customer/security data).

---

## Status

**v0.0.0** — PR 1 scaffold only. NOT production-ready.

Full v1 plan: 25 PRs over 9-10 weeks with Oracle review per PR. See [docs/PLAN.md](../../docs/PLAN.md) for the executable plan (added in PR 2).

| Stage | PRs | Description |
|---|---|---|
| 1: Foundation | 1-9 | Interface + 5 middleware boundaries + 0 connectors |
| 2: Connectors + Pilot | 10-16 | jira + github + atoms + 10-ticket pilot ≥70% FPBAR |
| 3: Composition | 17-21 | Sidecar wrappers (DDD → deep-design → pr-review → SDD → review-work) |
| 4: Production-Ready Gate | 22-25 | 50-task corpus + composite metric + verdict declaration |
