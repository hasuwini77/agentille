# Subagent roster per task category

After classifying, dispatch this combination. Read top-to-bottom — order matters.

## planning
- **agentille-planner** (Opus)
- *No executor, no reviewers.* Output is the plan itself.

## research
- **agentille-planner** with research-mode prefix (Opus): "Produce a comparison table with trade-offs. Do not implement."
- *No executor.* Output is the research report.

## feature
- **agentille-planner** (Opus) — IF hasMultipleSubtasks, else skip
- **agentille-executor** (Sonnet) — one per parallel step from the plan, max 3 parallel
- **agentille-code-reviewer** (Sonnet)
- **agentille-design-reviewer** (Sonnet) — IF hasUIComponent

## bugfix
- **debug-then-fix**: spawn a single agentille-executor (Sonnet) prefixed with "Reproduce → isolate → hypothesize → fix → regression test." Skip planner unless the bug is in ≥2 files.
- **agentille-code-reviewer** (Sonnet)
- **agentille-design-reviewer** (Sonnet) — IF hasUIComponent

## refactor
- **agentille-planner** (Opus) — IF hasMultipleSubtasks, else skip
- **agentille-executor** (Sonnet)
- **agentille-code-reviewer** (Sonnet) — REQUIRED — refactors are exactly where regressions hide
- *No design-reviewer* (refactor by definition has no visible change; if visual change emerges, that's the code-reviewer's BLOCKER finding)

## design
- **agentille-executor** (Sonnet) — implements the visual change
- **agentille-design-reviewer** (Sonnet — vision is native) — REQUIRED
- *Code-reviewer optional* — only if the design change required logic changes (state, handlers). For pure CSS/markup tweaks, skip.

## debug
- **debug-loop** (agentille-executor with Sonnet, systematic-debugging prefix): reproduce → isolate → hypothesize → verify. Surface the root cause, propose a fix.
- *No reviewers until a fix is applied — at which point promote to bugfix flow.*

## review
- **agentille-code-reviewer** (Sonnet) — the only subagent. No executor (user is asking for review, not changes).
- **agentille-design-reviewer** (Sonnet) — IF the target is UI code

## Hard cap

Never dispatch more than 3 executor subagents in parallel. If the plan has 5 parallel steps, batch them: 3 first, then 2.
