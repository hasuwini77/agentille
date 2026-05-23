# Model routing — subagent role → Claude model

Encodes the user's existing rule (Opus for plan, Sonnet for execution) and extends it with token-aware fallbacks based on the user's `thinkingDepth` profile field.

## Default routing

| Role | Default | If `thinkingDepth = quick` | Notes |
|---|---|---|---|
| planner | **claude-opus-4-7** | claude-sonnet-4-6 | Plans set direction; pay for quality |
| executor | **claude-sonnet-4-6** | claude-sonnet-4-6 | No downgrade — broken code is more expensive than tokens |
| code-reviewer | **claude-sonnet-4-6** | claude-sonnet-4-6 | Reviews catch regressions; do not downgrade |
| design-reviewer | **claude-sonnet-4-6** | claude-sonnet-4-6 | Sonnet 4.6 has native vision — required for screenshot analysis |
| classifier | **claude-haiku-4-5-20251001** | claude-haiku-4-5-20251001 | But: heuristic from classifier.md is preferred — only call Haiku as fallback if heuristics all miss |
| final-summary | **claude-haiku-4-5-20251001** | claude-haiku-4-5-20251001 | Recap, format, hand off — small model is fine |

## Profile-driven overrides

- **`thinkingDepth = always`** → upgrade `code-reviewer` to **claude-opus-4-7** for high-risk paths (api routes, auth, payments). For everything else, stay on Sonnet.
- **`thinkingDepth = quick`** → downgrade `planner` to Sonnet (the user is signaling they want speed over depth).
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
