# Regression Fixtures Index

> **Source**: R1 Librarian's documented OSS prior-art failure cases. Each row becomes a named regression test before v1 ships (PR 22-25 production-ready gate).
>
> **Why pre-document fixtures now**: Failure modes that hurt other tools must not silently re-emerge here. R1 Librarian researched 8 OSS analogs (Continue.dev, Cursor, Aider, Claude Code, Cline, Copilot Workspace, Devin, MCP spec) and surfaced 5 distinct failure patterns. Each is encoded below as an executable test.

---

## Regression test catalog (6 cases)

### F-1: Silent connector failure (Continue.dev #6790)

**OSS failure**: Continue HTTP context provider silently returned empty results due to null-check regression in `createContextItem`. Users discovered breakage only when downstream output degraded — no error surfaced.

**Our regression test**:
```bash
# tests/regression/f1-silent-connector-failure.test.ts (Stage 1 PR 9)
GIVEN: A connector configured with bad credentials (e.g., expired Jira token)
WHEN:  Phase 2 Collect invokes the connector
EXPECT:
  - Connector returns NOT empty array; instead emits structured error
  - Bundle gaps[] receives {expected: "<source>", reason: "<error_classification>"}
  - Audit log entry has duration_ms > 0 and result_hash references error response
  - User-visible warning at Phase 3 review: "⚠ <source>: <reason>"
ASSERTION:
  jq '.gaps | length > 0' bundle.context.json  # Must be true
  jq '.gaps[] | select(.expected == "<source>")' bundle.context.json  # Must exist
  ! grep -q "AUTHENTICATION_FAILED" bundle.context.json  # Should NOT silently swallow
```

**Why this matters**: Replay determinism (Boundary 4) requires that errors are recorded as first-class events. Silent empty responses break the audit contract.

---

### F-2: Context accumulation overflow (Continue.dev #9797)

**OSS failure**: Continue grew conversation history with retrieved context unboundedly, hitting 19k+ tokens by turn 6. No compaction strategy.

**Our regression test**:
```bash
# tests/regression/f2-context-overflow.test.ts (Stage 2 PR 14)
GIVEN: A task that triggers collection of 50 items totaling >12000 tokens
WHEN:  Phase 2 Collect runs with cost_budget=12000
EXPECT:
  - At cost_tokens >= 10000: switch to titles-only mode for remaining items
  - At cost_tokens >= 12000: abort collection; surface gaps[] for un-fetched
  - Active compaction: lowest relevance_score items dropped to titles-only first
  - Audit log entry: {action: "compaction", dropped_item_count: N, reason: "ceiling_hit"}
ASSERTION:
  jq '.cost_tokens <= 12000' bundle.context.json  # Strict ceiling
  jq '.items[] | select(.content == "[titles-only]") | length > 0' bundle.context.json
  ! grep -i "context_window_exceeded" runtime.log  # Should never reach LLM overflow
```

**Why this matters**: 12k cost ceiling is locked default (Section 0 #3); active compaction is R4 NR-2 hardening over plain rejection.

---

### F-3: VS Code architecture coupling (Continue.dev #10508)

**OSS failure**: Continue's tight coupling to VS Code extension host meant a runtime architecture shift broke MCP, sockets, retrieval — entire feature set disabled.

**Our regression test**:
```bash
# tests/regression/f3-runtime-coupling.test.ts (Stage 1 PR 5)
GIVEN: Source code under src/connectors/
WHEN:  Static analysis scans for opencode-specific imports
EXPECT:
  - ZERO imports from "opencode/*" or "@opencode/*" namespaces in connector code
  - Connectors interact with environment ONLY via:
    * .connector.yaml declarations
    * MCP tool calls (which are runtime-agnostic JSON-RPC)
    * Standard fs/process APIs
  - Adapter layer (src/adapters/opencode-bindings.ts) is the ONLY file that touches opencode runtime APIs
ASSERTION:
  ! grep -rn "from ['\"]opencode" src/connectors/  # Must be empty
  ! grep -rn "from ['\"]@opencode" src/connectors/  # Must be empty
  test -f src/adapters/opencode-bindings.ts  # Adapter exists
```

**Why this matters**: R4 NR-5 sidecar-wrapper composition assumes runtime-agnostic connectors. Coupling regressions block multi-runtime portability (which is the OSS appeal axis #2).

---

### F-4: Hallucinated source reference (Aider #4691)

**OSS failure**: Aider's LLM hallucinates non-existent file names, requesting them via `/add` → user approves blindly → file-not-found → infinite loop.

**Our regression test**:
```bash
# tests/regression/f4-hallucinated-source.test.ts (Stage 2 PR 14)
GIVEN: A bundle item with uri="jira://NONEXISTENT-99999"
WHEN:  Phase 3 Synthesize runs validation
EXPECT:
  - Validation pass MUST verify URI resolves (HEAD request or MCP probe)
  - Unresolved URI → bundle item moved to gaps[] with reason: "uri_unresolvable"
  - Pre-approval validation: NO bundle items with unresolved URIs survive into bundle.lock.json
ASSERTION:
  for item in $(jq -r '.items[].uri' bundle.context.json); do
    # Each URI must be resolvable
    test "$(probe_uri $item)" = "200" || echo "FAIL: $item"
  done
  jq '.items[] | select(.approved == true) | .uri' bundle.context.json | wc -l == count of resolved
```

**Why this matters**: Bundles handed off to downstream skills (Stage 3) MUST contain only verified references. Hallucinations propagate into agent prompts and produce wrong fixes.

---

### F-5: No audit trail for context (Cursor — structural)

**OSS failure**: Cursor's IDE context assembly is ephemeral. Users debugging "why did Cursor generate wrong code?" cannot replay what context was used.

**Our regression test**:
```bash
# tests/regression/f5-audit-completeness.test.ts (Stage 1 PR 7)
GIVEN: A bundle assembled end-to-end (Phase 0 → Phase 4 handoff)
WHEN:  Audit log examined
EXPECT:
  - Every external MCP call has a corresponding audit ndjson entry
  - Every bash exec has an audit entry
  - Every file write under .opencode/ has an audit entry
  - Each entry has: ts, actor, phase, action, args, result_hash, duration_ms
  - result_hash maps to a cached file at .opencode/audit/<date>/results/<hash>.json
ASSERTION:
  AUDIT_ENTRIES=$(wc -l < .opencode/audit/<date>/<bundle_id>.ndjson)
  EXTERNAL_CALLS=$(jq '.items | length' bundle.context.json)
  test $AUDIT_ENTRIES -ge $EXTERNAL_CALLS  # At least one audit per item
  for hash in $(jq -r '.[]?.result_hash' .opencode/audit/<date>/<bundle_id>.ndjson); do
    test -f ".opencode/audit/<date>/results/$hash.json" || echo "FAIL: $hash missing"
  done
```

**Why this matters**: Audit boundary (Boundary 4) is the differentiator vs Cursor. If audit is incomplete, replay determinism (PR 7) fails.

---

### F-6: Approval-fatigue rubber-stamping (Cline — empirical)

**OSS failure**: Cline's per-action approval gate gets disabled by users at scale due to friction. Mandatory gates without UX hardening collapse to rubber-stamps.

**Our regression test**:
```bash
# tests/regression/f6-rubber-stamp-throttle.test.ts (Stage 1 PR 8)
GIVEN: 20 consecutive bundle approvals where 19 are no-edit (95% rate)
WHEN:  21st bundle review begins
EXPECT:
  - Throttle TRIGGERS at the 19/20 = 95% boundary (>90% threshold per R4 NR-3)
  - fast_path_enabled = false for next 10 bundles
  - Terminal warning: "⚠ Fast-path disabled: 19/20 recent bundles approved without edit..."
  - Throttle event logged to .opencode/metrics/throttle.ndjson
ASSERTION:
  for i in {1..20}; do simulate_bundle_approval --no-edit; done
  RESULT=$(simulate_bundle_review --bundle-id=21 --check-fast-path)
  test "$RESULT" = "DISABLED"
  jq -e '. | length >= 1' .opencode/metrics/throttle.ndjson
```

**Why this matters**: R4 NR-3 contingency is the empirical safeguard. Without this regression test, the throttle could be silently broken in a refactor and rubber-stamping returns.

---

## How fixtures are organized in repo

```
tests/regression/
├── README.md                       # Index + how to run
├── f1-silent-connector-failure.test.ts
├── f2-context-overflow.test.ts
├── f3-runtime-coupling.test.ts
├── f4-hallucinated-source.test.ts
├── f5-audit-completeness.test.ts
└── f6-rubber-stamp-throttle.test.ts
```

Each file maps 1:1 to a row above. CI runs the full suite per PR; fixture failures BLOCK merge.

**PR mapping**:
- F-3 lands in PR 5 (connector interface)
- F-1, F-5 land in PR 7 (audit + replay)
- F-6 lands in PR 8 (boundary middleware)
- F-2, F-4 land in PR 14 (Phase 2/3 Collect+Synthesize)
- All 6 must pass before PR 22 (production-ready gate)

---

## Forward-compat: future failure cases

When new OSS analogs ship and fail in novel ways, this index appends rows. Specifically watch:
- **Devin** — bundle-not-shareable failure mode (sandbox isolation)
- **Copilot Workspace** — plan-step-context-loss failure mode
- **Future MCP spec versions** — schema-drift failure mode

Each new row triggers a follow-up PR with corresponding test fixture before considering v2.
