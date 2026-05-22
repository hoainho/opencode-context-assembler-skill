# Context Assembler

> **The pre-task artifact producer.** Collects multi-source context into a user-reviewed immutable bundle before any AI task runs.

An opensource [opencode](https://github.com/opencode-ai/opencode) skill that solves **context fragmentation** — the 15-minute "where was that decision again — Slack? Jira? PR? Sheet?" tax that happens before every task.

## What makes Context Assembler different

| | Continue / Cursor | Aider | Claude Code | Devin | **Context Assembler** |
|---|---|---|---|---|---|
| Pre-task multi-source bundle | ❌ | ❌ | ❌ | ❌ | ✅ |
| User-curated (not AI-driven) | @ per-item | /add | Auto | Auto | ✅ explicit |
| Reviewable artifact before execute | ❌ | ❌ | ❌ | ❌ | ✅ mandatory gate |
| Immutable + replayable | ❌ | ❌ | jsonl log | ❌ | ✅ SHA-256 lock.json |
| Hard permission boundaries | ❌ | partial | ❌ | sandboxed | ✅ 5 middleware-enforced |
| Cross-source (Slack+Jira+Confluence) | via MCP | ❌ | ❌ | browser | ✅ first-class |

**The decisive gap**: No existing tool offers **pre-task user-curated multi-source context bundles that the user can inspect, edit, save, and reuse before handing to an executor**.

## Status

**v0.0.0** — Scaffold (PR 1 of 25). NOT production-ready yet.

This repo implements [the v1 plan](https://github.com/hoainho/opencode-context-assembler-skill/blob/main/docs/PLAN.md) over 25 PRs with Oracle review per PR.

| Stage | PRs | Status |
|---|---|---|
| 1: Foundation | 1-9 | In progress (PR 1) |
| 2: Connectors + Pilot | 10-16 | Planned |
| 3: Composition | 17-21 | Planned |
| 4: Production-Ready Gate | 22-25 | Planned |

## The 7 anti-features (what this skill will NEVER do)

1. NO autonomous task decomposition
2. NO auto-execute after assembly (mandatory review gate)
3. NO smart source selection (sources explicit per task-type)
4. NO proactive polling / background watch
5. NO cross-task synthesis
6. NO write-back to sources (read-only audit-proven)
7. NO LLM-generated narrative (raw quotes with citations only)
8. NO embedding service in v1 (deterministic content-hash ranking)

## The 5 permission boundaries

All enforced as **middleware**, not convention:

1. **Write boundary** — No commit/push/merge/reset --hard to protected branches
2. **Artifact cap** — ≤5 auto-bundles/day; HMAC-signed counter
3. **Surface boundary** — No Slack/Jira/team broadcast without literal `APPROVE SEND` per call
4. **Audit boundary** — Every action logged + replayable via `context-assembler replay <bundle_id>`
5. **Tool boundary** — Destructive commands (rm -rf, DROP TABLE, force push) blocked at runtime

## PRODUCTION-READY criteria (composite, all 4 must pass)

| Metric | Threshold |
|---|---|
| First-Pass Bundle Acceptance Rate (FPBAR) | ≥80% (≥70% per-category) |
| Replay determinism | ≥99% |
| Bundle coverage rate | ≥30% |
| Time-to-handoff median | ≤5min cold / ≤90s recall-hit |

20% of pilot corpus dual-rated by senior peer (defeats Hawthorne effect).

## Installation (post-v1)

```bash
# After v1.0.0 ships
git clone https://github.com/hoainho/opencode-context-assembler-skill ~/.config/opencode/skills/context-assembler
context-assembler init  # Templates user values into reference.yaml
```

## Composition with other opencode skills

Context Assembler is **upstream infrastructure**. It produces bundle artifacts; downstream skills consume them via sidecar wrappers (zero modification to upstream skills):

- `bin/cba-wrap-ddd.sh` → diagnostic-driven-debugging
- `bin/cba-wrap-deep-design.sh` → deep-design (Metis/Oracle agents)
- `bin/cba-wrap-pr-code-reviewer.sh` → pr-code-reviewer (4 parallel subagents)
- `bin/cba-wrap-sdd.sh` → subagent-driven-development (implementer.md injection)
- `bin/cba-wrap-review-work.sh` → review-work (5 parallel context-mining subagents)

## License

MIT — see [LICENSE](./LICENSE)

## Related

- [opencode](https://github.com/opencode-ai/opencode) — the agent runtime
- [diagnostic-driven-debugging-skill](https://github.com/hoainho/opencode-diagnostic-debugging-skill) — previous skill by same author (proves the PR-gated + oracle-reviewed development cadence)
- [Model Context Protocol](https://modelcontextprotocol.io) — the MCP spec this skill builds on
