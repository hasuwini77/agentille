# Model routing — subagent role → Claude model

Pay Opus only where its reasoning is load-bearing — direction-setting and judgment-heavy review — and tier the rest by the size of the work in front of the role. Token-aware fallbacks key off the user's `thinkingDepth` profile field **and** the diff/plan size, not just a single quick/slow switch.

**Dispatch with model aliases (`fable` / `opus` / `sonnet` / `haiku`), not pinned IDs.** Aliases track the latest tier per Claude Code, so a rotated or unavailable exact ID can't hard-fail a dispatch on an OSS user's machine. **This makes same-tier model releases zero-touch: when a newer model ships within a tier (e.g. a new Sonnet), the alias resolves to it automatically — no edit to this file, the agent frontmatter, or the dispatch table is required.** The agent frontmatter carries the same aliases as a fallback default. The tier *identities* — kept here as rationale, not as dispatch values, and deliberately version-agnostic — are: **fable** = the top tier above Opus (deepest reasoning; dispatched only under the explicit `--fable` flag, never by default routing), **opus** = the latest Opus (native vision, the default planning/judgment/escalation ceiling), **sonnet** = the latest Sonnet (execution-grade reasoning, the default workhorse), **haiku** = the latest Haiku (classification/recap/scaffolding).

> **Per-provider caveat:** the zero-touch guarantee holds on the Anthropic API, where aliases track the newest model in each tier. Bedrock / Vertex / Foundry deployments can lag — there an alias resolves to whatever that provider currently maps it to, until the user pins full model IDs or `ANTHROPIC_DEFAULT_*_MODEL` env vars. Zero-touch is a per-provider property, not something agentille controls.
>
> **Effort** (`low`→`max`) deepens reasoning without changing the tier. Agent-def frontmatter carries a static default; the table below is what the mod sets per dispatch.

## Default routing

Model · effort per role. Size/risk/depth come from the dispatch header (`SKILL.md` → "Dispatch header"); the mod enforces this table, the orchestrator passes the model as fallback.

| role | default | size=large | risk auth/money | thinkingDepth=quick |
|---|---|---|---|---|
| planner | opus · high | opus · xhigh | — | sonnet · medium |
| plan-reviewer | sonnet · medium | opus · high | — | skipped |
| ui-prototyper | opus · high | opus · high | — | sonnet · medium |
| executor | sonnet · medium | sonnet · high | sonnet · high | sonnet · medium |
| code-reviewer | sonnet · medium | opus · high | opus · high | sonnet · medium |
| design-reviewer | opus · high | opus · high | opus · high | opus · high (never downgraded) |
| security-reviewer | opus · high | opus · high | opus · max | sonnet · high |

Executor never changes model (only effort). Classifier = heuristic (Haiku only if every heuristic misses); final-summary = haiku. Also skip the plan-reviewer for a ≤3-step fully sequential plan.

## Tiering the review roles by size

Two roles pick their model from the size of the work, not a flat default. Resolve at dispatch time:

- **code-reviewer** → **Opus** if *any* of: more than one file with logic changes, total changed LoC > ~150, a public/exported API or schema changed, or the diff touches auth / sessions / data-flow / money. Otherwise **Sonnet**. (A `quick` thinkingDepth forces Sonnet regardless.)
- **plan-reviewer** → **Opus** if the plan has ≥6 steps OR any step modifies shared contracts / architecture / a public interface. Otherwise **Sonnet**. Skip entirely on `thinkingDepth=quick` (don't downgrade — skip). Also skip for a ≤3-step fully sequential plan — no parallel-safety risk regardless of mode.

When in genuine doubt about which tier a diff falls in, prefer Opus for the *review* (a missed regression costs more than the token delta) — but do not reflexively reach for Opus on a clearly small, single-file change.

## Profile-driven overrides

- **`thinkingDepth = quick`** → the last column of the table; **skip the `plan-reviewer`** entirely (quick = trust the plan and go). `design-reviewer` stays Opus — the one place agentille never trades down.
- **`challengeLevel = ruthless`** → keep all models at default; the rigor comes from the prompt, not the model.

## Hard rules

- **Never downgrade design-reviewer.** Vision matters; without it the agent guesses.
- **Never use Haiku for executor.** Haiku writes correct-looking code that subtly breaks.
- **Never upgrade executor.** Executor stays Sonnet — never up or down.
- **Declare `model:` on every dispatch** (fallback when the mod is off).

## Escalation ladder

Evidence is **observed by the mod**, not claimed by the orchestrator.

- **Plan:** the mod reads each plan-reviewer verdict. 1st REVISE → next planner dispatch runs opus · max. 2nd REVISE → next planner dispatch is a Fable candidate.
- **Fix:** the mod counts `mode=fix` executor dispatches per run. Attempt 2 → effort high; attempt ≥3 → effort max. A `mode=diagnose` planner dispatch after ≥3 fix attempts → Fable candidate.
- **Fable gate** (all must pass, else opus · max with the reason logged): candidate · `profile.routing.autoFable` not false · fewer than `maxFablePerRun` (default 1) Fable spawns this run · `seven_day` plan usage below `fableWeeklyCeiling` (default 60%).

Result: Fable is rare by construction — it needs two observed failures at Opus max effort first.

### `--fable` — manual override

Claude Fable 5 is a tier **above Opus** (alias `fable`). `fable=forced` (user typed `--fable`): judgment roles (planner, ui-prototyper, design-reviewer, security-reviewer, large code-/plan-reviewer) run Fable; executor never; classifier and final-summary stay Haiku. Bypasses the gate — the user chose it.

**Fallback (older builds):** if the `fable` alias doesn't resolve, re-dispatch that role **once** with `opus` and note it in the run log — never hard-fail, never retry-loop.

**Placement rule:** `fable` appears ONLY in dispatch-time model parameters — never in an agent def's `model:` frontmatter (that keeps the Opus fallback reachable).

See also: `workflow-mode.md` → "Flag composition".

## Workflow tier routing

The workflow tier uses the same role → model mapping as subagent mode:

- **Executor (build stages)** — Sonnet. Never upgrade.
- **code-reviewer (verify stages)** — tiered: Sonnet for small diffs, Opus for large/cross-cutting diffs (same size criteria as above).
- **design-reviewer (verify stages, UI buckets only)** — Opus, never downgrade.
- **security-reviewer (verify stages, security-tagged buckets only)** — Opus; → Sonnet if `thinkingDepth=quick`.

Workflow executor stages emit explicit `model:` in each `agent()` call (no mod escalation there — see `workflow-mode.md`). Full workflow stage/role mapping: `workflow-mode.md` → "Role → workflow stage mapping".
