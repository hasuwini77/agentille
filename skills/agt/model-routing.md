# Model routing — subagent role → Claude model

Pay Opus only where its reasoning is load-bearing — direction-setting and judgment-heavy review — and tier the rest by the size of the work in front of the role. Token-aware fallbacks key off the user's `thinkingDepth` profile field **and** the diff/plan size, not just a single quick/slow switch.

**Dispatch with model aliases (`opus` / `sonnet` / `haiku`), not pinned IDs.** Aliases track the latest tier per Claude Code, so a rotated or unavailable exact ID can't hard-fail a dispatch on an OSS user's machine. **This makes same-tier model releases zero-touch: when a newer model ships within a tier (e.g. a new Sonnet), the alias resolves to it automatically — no edit to this file, the agent frontmatter, or the dispatch table is required.** The agent frontmatter carries the same aliases as a fallback default. The tier *identities* — kept here as rationale, not as dispatch values, and deliberately version-agnostic — are: **opus** = the latest Opus (native vision, the planning/judgment/escalation ceiling), **sonnet** = the latest Sonnet (execution-grade reasoning, the default workhorse), **haiku** = the latest Haiku (classification/recap/scaffolding).

## Default routing

| Role | Default | Override |
|---|---|---|
| planner | **opus** | → Sonnet if `thinkingDepth=quick` (no escalation above Opus; large/cross-cutting plans stay Opus) |
| plan-reviewer | **sonnet** | → Opus for a large/cross-cutting plan (≥6 steps or any step touching shared contracts/architecture); skip if `thinkingDepth=quick`; also skip for a ≤3-step fully sequential plan |
| ui-prototyper | **opus** | → Sonnet if `thinkingDepth=quick`; → Opus under `--fable` (no-op, `--fable` is deprecated) |
| executor | **sonnet** | never up or down |
| code-reviewer | **tiered** (see below) | Sonnet for small diff (single file or ≤~150 LoC, no cross-cutting/security); Opus for large/cross-cutting diff; → Sonnet if `thinkingDepth=quick` |
| design-reviewer | **opus** | never downgrade (savings come from viewport scope, not model); → Opus under `--fable` (no-op) |
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

## `--fable` — deprecated backward-compat alias

The `fable` model is no longer available. `--fable` is retained as a **deprecated alias** that forces the **Opus ceiling** on all judgment-heavy roles: planner, ui-prototyper, design-reviewer, security-reviewer, and any size-escalated code-reviewer or plan-reviewer. Executor stays Sonnet; classifier and final-summary stay Haiku. `--fable` never hard-fails — it resolves to Opus transparently. Note in the run log that the flag is deprecated and may be removed in a future release. New work should rely on the size/risk auto-escalation above.

See also: `workflow-mode.md` → "Flag composition" for how `--fable` composes with `--plan` and workflow mode.

## Workflow tier routing

The workflow tier uses the same role → model mapping as subagent mode:

- **Executor (build stages)** — Sonnet. Never upgrade.
- **code-reviewer (verify stages)** — tiered: Sonnet for small diffs, Opus for large/cross-cutting diffs (same size criteria as above).
- **design-reviewer (verify stages, UI buckets only)** — Opus, never downgrade.
- **security-reviewer (verify stages, security-tagged buckets only)** — Opus; → Sonnet if `thinkingDepth=quick`.

Workflow executor stages emit explicit `model:` in each `agent()` call. Do not rely on defaults. Full workflow stage/role mapping: `workflow-mode.md` → "Role → workflow stage mapping".
