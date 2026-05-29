# Model routing — subagent role → Claude model

Pay Opus only where its reasoning is load-bearing — direction-setting and judgment-heavy review — and tier the rest by the size of the work in front of the role. Token-aware fallbacks key off the user's `thinkingDepth` profile field **and** the diff/plan size, not just a single quick/slow switch.

## Default routing

| Role | Default | If `thinkingDepth = quick` | Notes |
|---|---|---|---|
| planner | **claude-opus-4-8** | claude-sonnet-4-6 | Plans set direction; pay for quality |
| plan-reviewer | **claude-sonnet-4-6** | *skipped* | Structured checklist over the plan artifact (goal correct? coverage? parallel-safe? real verification?) — Sonnet handles it. **Upgrade to Opus** only for a *large/cross-cutting* plan (≥6 steps, or any step that touches shared contracts / architecture). On `quick`, skip entirely. **Also skip** for a ≤3-step fully sequential plan (no parallel slices, even in team mode) — no parallel-safety risk to catch. |
| executor | **claude-sonnet-4-6** | claude-sonnet-4-6 | No downgrade — broken code is more expensive than tokens |
| code-reviewer | **tiered** (see below) | claude-sonnet-4-6 | **Sonnet for a small diff** (single file *or* ≤~150 LoC changed, no cross-cutting/security surface); **Opus for a large or cross-cutting diff** (multi-file logic, public API, auth/data-flow). Most diffs are small — Sonnet clears them; Opus is reserved for where subtle regressions actually hide. |
| design-reviewer | **claude-opus-4-8** | claude-opus-4-8 | Never downgrade — Opus 4.8 has native vision AND the strongest design judgment; design review is agentille's differentiator. The savings lever for design is **viewport scope** (capture only the viewports that matter — see `agentille-design-reviewer.md`), not the model. |
| security-reviewer | **claude-opus-4-8** | claude-sonnet-4-6 | Auth-bypass / injection reasoning is the costliest miss, and it only runs when the task is security-tagged (rare) — default to the strongest reasoner |
| classifier | **claude-haiku-4-5-20251001** | claude-haiku-4-5-20251001 | But: heuristic from classifier.md is preferred — only call Haiku as fallback if heuristics all miss |
| final-summary | **claude-haiku-4-5-20251001** | claude-haiku-4-5-20251001 | Recap, format, hand off — small model is fine |

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
- **Always declare the model in the subagent dispatch.** Don't let Claude Code default — be explicit.
