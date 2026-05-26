# Subagent roster per task category

> **Authority:** the dispatch decision table in `skills/agt/SKILL.md` is the tie-breaker. This doc is the detail/rationale — if it ever conflicts with that table, the table wins.

After classifying, dispatch this combination. Read top-to-bottom — order matters.

## planning
- **agentille-planner** (Opus)
- **agentille-plan-reviewer** (Sonnet; → Opus for a large/cross-cutting plan) — the plan IS the deliverable here, so review it before handing back. Skip on `thinkingDepth=quick`.
- *No executor.* Output is the (reviewed) plan itself.

## research
- **agentille-planner** with research-mode prefix (Opus): "Produce a comparison table with trade-offs. Do not implement."
- *No executor.* Output is the research report.

## feature
- **agentille-planner** (Opus) — IF hasMultipleSubtasks, else skip
- **agentille-plan-reviewer** (Sonnet; → Opus for a large/cross-cutting plan) — IF the planner ran; critiques the plan before any executor starts. Skip on `thinkingDepth=quick`.
- **agentille-executor** (Sonnet) — one per parallel step from the plan, max 3 parallel
- **agentille-code-reviewer** (tiered: Sonnet for a small diff / Opus for large/cross-cutting)
- **agentille-design-reviewer** (Opus) — IF hasUIComponent. Pass the clarified `viewports: [...]` (see SKILL.md → "Clarify the viewport scope for UI work").

## bugfix
- **debug-then-fix**: spawn a single agentille-executor (Sonnet) running its built-in Debugging discipline (root cause → pattern → single hypothesis → root-cause fix + regression test — see `agents/agentille-executor.md`). Skip planner unless the bug is in ≥2 files.
- **agentille-code-reviewer** (tiered: Sonnet for a small diff / Opus for large/cross-cutting)
- **agentille-design-reviewer** (Opus) — IF hasUIComponent. Pass the clarified `viewports: [...]`.

## refactor
- **agentille-planner** (Opus) — IF hasMultipleSubtasks, else skip
- **agentille-plan-reviewer** (Sonnet; → Opus for a large/cross-cutting plan) — IF the planner ran. Skip on `thinkingDepth=quick`.
- **agentille-executor** (Sonnet)
- **agentille-code-reviewer** (tiered: Sonnet for a small diff / Opus for large/cross-cutting) — REQUIRED — except for pure renames/moves with zero logic delta (files renamed/moved only), where it may be skipped. Refactors with any logic change still require it — regressions hide here.
- *No design-reviewer* (refactor by definition has no visible change; if visual change emerges, that's the code-reviewer's BLOCKER finding)

## design
- **agentille-executor** (Sonnet) — implements the visual change
- **agentille-design-reviewer** (Opus — native vision) — REQUIRED. Pass the clarified `viewports: [...]` (see SKILL.md → "Clarify the viewport scope for UI work").
- *Code-reviewer optional* — only if the design change required logic changes (state, handlers). For pure CSS/markup tweaks, skip. When run, it's tiered (Sonnet for a small diff / Opus for large).

## debug
- **debug-loop** (agentille-executor, Sonnet): runs the executor's built-in Debugging discipline (`agents/agentille-executor.md`) — root cause before any fix, one hypothesis at a time, stop and question the architecture after 3 failed fixes. Surface the root cause, propose a fix.
- *No reviewers until a fix is applied — at which point promote to bugfix flow.*

## review
- **agentille-code-reviewer** (tiered: Sonnet for a small diff / Opus for large/cross-cutting) — the only subagent. No executor (user is asking for review, not changes).
- **agentille-design-reviewer** (Opus) — IF the target is UI code. Pass the clarified `viewports: [...]`.

## Hard cap

Never dispatch more than 3 executor subagents in parallel. If the plan has 5 parallel steps, batch them: 3 first, then 2.
