# Model routing — subagent role → Claude model

Pay Opus only where its reasoning is load-bearing — direction-setting and judgment-heavy review — and tier the rest by the size of the work in front of the role. Token-aware fallbacks key off the user's `thinkingDepth` profile field **and** the diff/plan size, not just a single quick/slow switch.

**Dispatch with model aliases (`opus` / `sonnet` / `haiku` / `fable`), not pinned IDs.** Aliases track the latest tier per Claude Code, so a rotated or unavailable exact ID can't hard-fail a dispatch on an OSS user's machine. The agent frontmatter carries the same aliases as a fallback default. The tier *identities* at time of writing — kept here as rationale, not as dispatch values — are: **opus** = Opus 4.8 (native vision, the everyday planning/judgment tier), **sonnet** = Sonnet 4.6, **haiku** = Haiku 4.5, **fable** = Claude Fable 5 (the strongest reasoning tier, vision-capable; escalation ceiling at ~2× opus per-token cost — and its tokenizer counts the *same content* as ~30% more tokens than the opus/sonnet tiers, so the effective spend per dispatch is closer to ~2.6× opus. Reserved for the largest/highest-stakes work).

## Default routing

| Role | Default | If `thinkingDepth = quick` | Notes |
|---|---|---|---|
| planner | **opus** | sonnet | Plans set direction; pay for quality. → **fable** for large/cross-cutting plans (≥6 steps or any step touching shared contracts/architecture) |
| plan-reviewer | **sonnet** | *skipped* | Structured checklist over the plan artifact (goal correct? coverage? parallel-safe? real verification?) — Sonnet handles it. **Upgrade to fable** only for a *large/cross-cutting* plan (≥6 steps, or any step that touches shared contracts / architecture). On `quick`, skip entirely. **Also skip** for a ≤3-step fully sequential plan (no parallel slices, even in team mode) — no parallel-safety risk to catch. |
| ui-prototyper | **opus** | sonnet | The Prototype Blueprint sets the design direction the whole UI build (and the design-reviewer's score) follows — pay for taste, the same logic as the planner. Only dispatched on UI build work (`design`, or `feature`+hasUI), so it runs rarely. → **fable** when the blueprint is design-system-scale (an explicit rebrand, or a shared token system / component set with ≥3 downstream consumers); → fable under `--fable`. |
| executor | **sonnet** | sonnet | No downgrade — broken code is more expensive than tokens |
| code-reviewer | **tiered** (see below) | sonnet | **sonnet for a small diff** (single file *or* ≤~150 LoC changed, no cross-cutting/security surface); **fable for a large or cross-cutting diff** (multi-file logic, public API, auth/data-flow). Most diffs are small — Sonnet clears them; fable is reserved for where subtle regressions actually hide. |
| design-reviewer | **opus** | opus | Never downgrade — opus has native vision and first-class design judgment; design review is agentille's differentiator. The savings lever for design is **viewport scope** (capture only the viewports that matter — see `agentille-design-reviewer.md`), not the model. → fable under `--fable` only. |
| security-reviewer | **fable** | sonnet | Auth-bypass / injection reasoning is the costliest miss, and it only runs when the task is security-tagged (rare) — default to the escalation ceiling. Graceful fallback: if fable is unavailable → opus + one log line. |
| classifier | **haiku** | haiku | But: heuristic from classifier.md is preferred — only call Haiku as fallback if heuristics all miss |
| final-summary | **haiku** | haiku | Recap, format, hand off — small model is fine |

## Tiering the review roles by size

Two roles pick their model from the size of the work, not a flat default. Resolve at dispatch time:

- **code-reviewer** → **fable** if *any* of: more than one file with logic changes, total changed LoC > ~150, a public/exported API or schema changed, or the diff touches auth / sessions / data-flow / money. Otherwise **Sonnet**. (A `quick` thinkingDepth forces Sonnet regardless.)
- **plan-reviewer** → **fable** if the plan has ≥6 steps OR any step modifies shared contracts / architecture / a public interface. Otherwise **Sonnet**. Skip entirely on `thinkingDepth=quick` (don't downgrade — skip). Also skip for a ≤3-step fully sequential plan — no parallel-safety risk regardless of mode.

When in genuine doubt about which tier a diff falls in, prefer fable for the *review* (a missed regression costs more than the token delta) — but do not reflexively reach for fable on a clearly small, single-file change.

## Profile-driven overrides

- **`thinkingDepth = quick`** → downgrade `planner`, `code-reviewer`, and `security-reviewer` to Sonnet (the user is signaling speed over depth), and **skip the `plan-reviewer` step entirely** (quick = trust the plan and go). `design-reviewer` stays Opus — vision + design judgment is the one place agentille never trades down.
- **`challengeLevel = ruthless`** → keep all models at default; the rigor comes from the prompt, not the model.

## Hard rules

- **Never downgrade design-reviewer.** Vision matters; without it the agent guesses.
- **Never use Haiku for executor.** Haiku writes correct-looking code that subtly breaks.
- **Never use fable for executor.** Executor stays Sonnet — never up or down.
- **Graceful fable fallback.** If the `fable` alias is unavailable on the user's Claude Code version or plan, fall back to **opus** and emit one log line (same pattern as team-mode degradation). Never hard-fail.
- **Always declare the model in the subagent dispatch.** Don't let Claude Code default — be explicit.
