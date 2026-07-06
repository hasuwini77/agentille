# Model routing — subagent role → Claude model

Pay Opus only where its reasoning is load-bearing — direction-setting and judgment-heavy review — and tier the rest by the size of the work in front of the role. Token-aware fallbacks key off the user's `thinkingDepth` profile field **and** the diff/plan size, not just a single quick/slow switch.

**Dispatch with model aliases (`fable` / `opus` / `sonnet` / `haiku`), not pinned IDs.** Aliases track the latest tier per Claude Code, so a rotated or unavailable exact ID can't hard-fail a dispatch on an OSS user's machine. **This makes same-tier model releases zero-touch: when a newer model ships within a tier (e.g. a new Sonnet), the alias resolves to it automatically — no edit to this file, the agent frontmatter, or the dispatch table is required.** The agent frontmatter carries the same aliases as a fallback default. The tier *identities* — kept here as rationale, not as dispatch values, and deliberately version-agnostic — are: **fable** = the top tier above Opus (deepest reasoning; dispatched only under the explicit `--fable` flag, never by default routing), **opus** = the latest Opus (native vision, the default planning/judgment/escalation ceiling), **sonnet** = the latest Sonnet (execution-grade reasoning, the default workhorse), **haiku** = the latest Haiku (classification/recap/scaffolding).

> **Per-provider caveat:** the zero-touch guarantee holds on the Anthropic API, where aliases track the newest model in each tier. Bedrock / Vertex / Foundry deployments can lag — there an alias resolves to whatever that provider currently maps it to, until the user pins full model IDs or `ANTHROPIC_DEFAULT_*_MODEL` env vars. Zero-touch is a per-provider property, not something agentille controls.
>
> **Orthogonal lever:** agent-def frontmatter also supports `effort` (`low`→`max`), which deepens reasoning without changing the model tier. agentille sets `effort: high` statically on its three judgment-heaviest defs (planner, security-reviewer, design-reviewer); routing decisions in this file stay model-tier-only.

## Default routing

| Role | Default | Override |
|---|---|---|
| planner | **opus** | → Sonnet if `thinkingDepth=quick` (no escalation above Opus; large/cross-cutting plans stay Opus) |
| plan-reviewer | **sonnet** | → Opus for a large/cross-cutting plan (≥6 steps or any step touching shared contracts/architecture); skip if `thinkingDepth=quick`; also skip for a ≤3-step fully sequential plan |
| ui-prototyper | **opus** | → Sonnet if `thinkingDepth=quick`; → Fable under `--fable` |
| executor | **sonnet** | never up or down |
| code-reviewer | **tiered** (see below) | Sonnet for small diff (single file or ≤~150 LoC, no cross-cutting/security); Opus for large/cross-cutting diff; → Sonnet if `thinkingDepth=quick` |
| design-reviewer | **opus** | never downgrade (savings come from viewport scope, not model); → Fable under `--fable` |
| security-reviewer | **opus** | → Sonnet if `thinkingDepth=quick` |
| classifier | **heuristic, no LLM** | Haiku only if every heuristic misses |
| final-summary | **haiku** | — |

## Tiering the review roles by size

Two roles pick their model from the size of the work, not a flat default. Resolve at dispatch time:

- **code-reviewer** → **Opus** if *any* of: more than one file with logic changes, total changed LoC > ~150, a public/exported API or schema changed, or the diff touches auth / sessions / data-flow / money. Otherwise **Sonnet**. (A `quick` thinkingDepth forces Sonnet regardless.)
- **plan-reviewer** → **Opus** if the plan has ≥6 steps OR any step modifies shared contracts / architecture / a public interface. Otherwise **Sonnet**. Skip entirely on `thinkingDepth=quick` (don't downgrade — skip). Also skip for a ≤3-step fully sequential plan — no parallel-safety risk regardless of mode.

When in genuine doubt about which tier a diff falls in, prefer Opus for the *review* (a missed regression costs more than the token delta) — but do not reflexively reach for Opus on a clearly small, single-file change.

## Profile-driven overrides

- **`thinkingDepth = quick`** → downgrade `planner`, `code-reviewer`, and `security-reviewer` to Sonnet (the user is signaling speed over depth), and **skip the `plan-reviewer` step entirely** (quick = trust the plan and go). `design-reviewer` stays Opus — vision + design judgment is the one place agentille never trades down.
- **`challengeLevel = ruthless`** → keep all models at default; the rigor comes from the prompt, not the model.

## Hard rules

- **Never downgrade design-reviewer.** Vision matters; without it the agent guesses.
- **Never use Haiku for executor.** Haiku writes correct-looking code that subtly breaks.
- **Never upgrade executor.** Executor stays Sonnet — never up or down.
- **Always declare the model in the subagent dispatch.** Don't let Claude Code default — be explicit.

## `--fable` — the Fable ceiling

Claude Fable 5 is a live, shipping model tier **above Opus** (alias `fable` — a first-class Claude Code model alias). With `--fable` present, force the **Fable ceiling** on all judgment-heavy roles this run: planner, ui-prototyper, design-reviewer, security-reviewer, and any size/risk-escalated code-reviewer or plan-reviewer. Executor stays Sonnet; classifier and final-summary stay Haiku — those are never upgraded. Fable costs more than Opus, which is exactly why it is **never part of default routing** — the flag is the only path to it, per run, chosen by the user.

**Fallback (older builds):** if a dispatch errors because the `fable` alias doesn't resolve, re-dispatch that role **once** with `opus` and note the downgrade in the run log — never hard-fail the run, never retry-loop. The interception point is the dispatch itself: model resolution happens per-dispatch and a failed dispatch returns a tool error the orchestrator observes.

**Placement rule:** `fable` appears ONLY in dispatch-time model parameters — never in any agent def's static `model:` frontmatter (those stay `opus`/`sonnet` as the alias-fallback defaults). This is what makes the Opus fallback reachable.

See also: `workflow-mode.md` → "Flag composition" for how `--fable` composes with `--plan` and workflow mode.

## Workflow tier routing

The workflow tier uses the same role → model mapping as subagent mode:

- **Executor (build stages)** — Sonnet. Never upgrade.
- **code-reviewer (verify stages)** — tiered: Sonnet for small diffs, Opus for large/cross-cutting diffs (same size criteria as above).
- **design-reviewer (verify stages, UI buckets only)** — Opus, never downgrade.
- **security-reviewer (verify stages, security-tagged buckets only)** — Opus; → Sonnet if `thinkingDepth=quick`.

Workflow executor stages emit explicit `model:` in each `agent()` call. Do not rely on defaults. Full workflow stage/role mapping: `workflow-mode.md` → "Role → workflow stage mapping".
