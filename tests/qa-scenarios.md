# QA Scenarios — Test Conventions + Anchor Notes

This file documents conventions for QA scenarios across all 25 PRs of the Context Assembler v1 plan, with specific notes about non-obvious test target dependencies.

---

## Anchor convention: HTML comment markers for case-sensitive grep targets

**Why**: Plan PR 1 acceptance scenario uses literal case-sensitive grep:
```bash
grep -c "anti-vision" skills/context-assembler/SKILL.md
```

Markdown headings naturally capitalize ("## Anti-vision — 8 things…"), so case-sensitive grep against the heading text returns 0. Two solutions exist; we picked option (a):

- ✅ **(a) HTML comment anchor** — `<!-- anti-vision -->` placed immediately before the heading. Preserves rendered output. Stable across heading rewords. Machine-greppable.
- ❌ (b) Lowercase the heading. Breaks Markdown style guide.
- ❌ (c) Update plan QA to `grep -ic`. Diverges from spec.

### Load-bearing anchors (DO NOT REMOVE)

| Anchor | Location | QA scenario uses it |
|---|---|---|
| `<!-- anti-vision -->` | `skills/context-assembler/SKILL.md` line 21 (above "## Anti-vision") | PR 1 acceptance: `grep -c "anti-vision"` ≥ 1 |

When future PRs rename headings or reorganize SKILL.md, **the anchor MUST move with the section** to preserve the QA contract. Add new anchors as new QA targets are introduced.

---

## Conventions for PR QA scenarios

### Acceptance criteria format
Every PR's acceptance criteria block in the plan (Section 3) must be **mechanical**, not subjective. Format:

```markdown
- **Acceptance**:
  - <invariant 1 stated as observable property>
  - <invariant 2 ...>
- **QA**:
  ```bash
  <command 1>  # Expected: <exact output / exit code>
  <command 2>
  ```
```

### Mechanical = ungameable
- Use `jq -e` for JSON property checks (returns non-zero if false; gameable assertions like `jq '.x == 5' | grep true` are bad)
- Use `test -f`, `test -d`, exit-code checks
- Use `grep -c "<literal>"` with explicit threshold; document case-sensitivity expectations
- Avoid: "review subjectively", "looks good", "user confirms"

### Negative cases are mandatory for schema/validator PRs
For PR 3 (JSON Schema), PR 5 (connector loader), PR 7 (audit replay) — the acceptance MUST include both:
- Positive fixtures that VALIDATE
- Negative fixtures that REJECT (with expected error class)

### Replay determinism scenarios
For PRs touching the audit/replay loop (PR 7, PR 14, PR 22):
```bash
HASH1=$(npx context-assembler-replay <fixture-id> --no-fetch | jq -r .hash)
for i in {1..N}; do
  REPLAY_HASH=$(npx context-assembler-replay <fixture-id> --no-fetch | jq -r .hash)
  test "$HASH1" = "$REPLAY_HASH" || echo "FAIL run $i"
done
```
N=10 minimum during PR review; N=100 in PR 22 production-ready gate.

---

## Composite metric scenarios (Stage 4)

PR 22 corpus run uses these definitions:

### FPBAR (First-Pass Bundle Acceptance Rate)
- **Numerator**: bundles where user invoked `bundle approve` without prior `bundle edit --drop`, `--note`, or `--refresh`
- **Denominator**: total bundles produced in the 50-task corpus
- **Threshold**: ≥80% aggregate AND ≥70% per category (bug-fix, feature, review)
- **Anti-game**: 20% dual-rated by Vân; rubber-stamp throttle (Boundary spec) prevents inflation

### Replay determinism
- **Numerator**: bundles where 10 consecutive replays produce bit-identical `bundle.lock.json` hash
- **Denominator**: 10 randomly-selected bundles from the corpus
- **Threshold**: ≥99% (i.e., 10/10)

### Bundle coverage rate
- **Numerator**: items in bundle that downstream skill explicitly read (via `consumed_bundle_id` audit annotation)
- **Denominator**: total items in bundle
- **Threshold**: ≥30% AND absolute floor "≥3 items used out of ≥10 collected" (R3 Metis NR-4 hardening — prevents tiny bundles trivially passing)

### Time-to-handoff (median)
- **Definition**: ms from `context-assembler create` invocation to `bundle approve` exit
- **Cold path**: no atom-recall hit. Threshold ≤300,000 ms (5 min).
- **Recall-hit path**: atom recall ≥80 confidence at Phase 1.5. Threshold ≤90,000 ms (90 sec).

---

## Failure-mode regression suite

See [`skills/context-assembler/references/regression-fixtures.md`](../skills/context-assembler/references/regression-fixtures.md) for the 6 regression cases (F-1 through F-6) sourced from R1 Librarian's OSS prior-art research. These run in CI per PR; fixture failure blocks merge.

---

## Stage exit gates

| Stage | PRs | Exit gate |
|---|---|---|
| 1: Foundation | 1-9 | All 5 boundaries enforced architecturally; replay determinism 100/100 on fixture; F-1, F-3, F-5, F-6 regression tests passing |
| 2: Connectors + Pilot | 10-16 | 10 real WIN tickets processed end-to-end; ≥7 bundles approved without edits (≥70% small-N FPBAR); all 5 boundaries triggered ≥1× in audit logs (proving they're hot, not dormant); F-2, F-4 added |
| 3: Composition | 17-21 | 5 sidecar wrappers (DDD, deep-design, pr-code-reviewer, SDD, review-work) each pass integration test showing bundle consumption + audit entry `consumed_bundle_id` |
| 4: Production-Ready Gate | 22-25 | All 4 composite metrics pass thresholds OR honest PARTIAL declaration with upgrade paths (same discipline as diagnostic-driven-debugging C3) |

---

## CI integration (post-PR-1)

PR 22 will introduce `.github/workflows/ci.yml` that runs:
1. Schema validation (PR 3 fixtures)
2. Connector loader tests (PR 5)
3. Audit replay determinism (PR 7)
4. Boundary unit tests (PR 8, 9)
5. Regression suite F-1 through F-6
6. End-to-end bundle creation (Stage 2 onward)

Until PR 22 ships CI, each PR's QA is run locally by author + verified by Oracle review against re-fetched files.
