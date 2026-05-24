# Model routing — subagent role → Claude model

Encodes the user's existing rule (Opus for plan **and review**, Sonnet for execution) and extends it with token-aware fallbacks based on the user's `thinkingDepth` profile field.

## Default routing

| Role | Default | If `thinkingDepth = quick` | Notes |
|---|---|---|---|
| planner | **claude-opus-4-7** | claude-sonnet-4-6 | Plans set direction; pay for quality |
| plan-reviewer | **claude-opus-4-7** | *skipped* | Catches a wrong/under-scoped plan before it wastes executors. On `quick`, skip the review entirely rather than downgrade |
| executor | **claude-sonnet-4-6** | claude-sonnet-4-6 | No downgrade — broken code is more expensive than tokens |
| code-reviewer | **claude-opus-4-7** | claude-sonnet-4-6 | Review is judgment-heavy and read-only/single-pass — Opus catches the subtle regressions Sonnet skims past, at a small token premium (no write-loop) |
| design-reviewer | **claude-opus-4-7** | claude-opus-4-7 | Never downgrade — Opus 4.7 has native vision AND the strongest design judgment; design review is agentille's differentiator |
| security-reviewer | **claude-opus-4-7** | claude-sonnet-4-6 | Auth-bypass / injection reasoning is the costliest miss; default to the strongest reasoner |
| classifier | **claude-haiku-4-5-20251001** | claude-haiku-4-5-20251001 | But: heuristic from classifier.md is preferred — only call Haiku as fallback if heuristics all miss |
| final-summary | **claude-haiku-4-5-20251001** | claude-haiku-4-5-20251001 | Recap, format, hand off — small model is fine |

## Profile-driven overrides

- **`thinkingDepth = quick`** → downgrade `planner`, `code-reviewer`, and `security-reviewer` to Sonnet (the user is signaling speed over depth), and **skip the `plan-reviewer` step entirely** (quick = trust the plan and go). `design-reviewer` stays Opus — vision + design judgment is the one place agentille never trades down.
- **`challengeLevel = ruthless`** → keep all models at default; the rigor comes from the prompt, not the model.

## When the profile says "minimize cost"

(Not a current profile field but mentally available — for solo developers paying their own bills.)

- Use heuristic classifier (no LLM)
- Skip planner for single-step tasks
- Skip code-reviewer for trivial diffs (≤5 LoC changed, no logic shift)
- Always use Haiku for final-summary

## Hard rules

- **Never downgrade design-reviewer.** Vision matters; without it the agent guesses.
- **Never use Haiku for executor.** Haiku writes correct-looking code that subtly breaks.
- **Always declare the model in the subagent dispatch.** Don't let Claude Code default — be explicit.
