# Subagent roster per task category

> **Authority:** the dispatch decision table in `skills/agt/SKILL.md` is the tie-breaker. This doc is the detail/rationale — if it ever conflicts with that table, the table wins.

After classifying, dispatch this combination. Read top-to-bottom — order matters.

## planning
- **agentille-planner** — the plan IS the deliverable here, so review it before handing back.
- **agentille-plan-reviewer** — skip on `thinkingDepth=quick` or for a ≤3-step sequential plan (see `model-routing.md` → "Default routing"). Model per `model-routing.md`.
- *No executor.* Output is the (reviewed) plan itself.

## research
- **agentille-planner** with research-mode prefix: "Produce a comparison table with trade-offs. Do not implement."
- *No executor.* Output is the research report.

## feature
- **agentille-planner** — IF hasMultipleSubtasks, else skip
- **agentille-plan-reviewer** — IF the planner ran; critiques the plan before any executor starts. Skip on `thinkingDepth=quick` or when the plan is ≤3 steps and fully sequential (no parallel slices).
- **agentille-ui-prototyper** — IF hasUIComponent. Runs **before** the executor and frames the component design (the UI Prototype Blueprint); the executor builds against it. Model per `model-routing.md`. Skip when there's no UI to frame.
- **agentille-executor** — one per parallel step from the plan, max 3 parallel. When a ui-prototyper Blueprint exists, pass it in the executor's dispatch prompt as the design contract.
- **agentille-code-reviewer** — tiered by diff size; see `model-routing.md` → "Tiering the review roles by size"
- **agentille-design-reviewer** — IF hasUIComponent. Pass the clarified `viewports: [...]` (see `SKILL.md` → "Clarify before planning").

## bugfix
- **debug-then-fix**: spawn a single agentille-executor running its built-in Debugging discipline (root cause → pattern → single hypothesis → root-cause fix + regression test — see `agents/agentille-executor.md`). Skip planner unless the bug is in ≥2 files.
- **agentille-code-reviewer** — tiered by diff size
- **agentille-design-reviewer** — IF hasUIComponent. Pass the clarified `viewports: [...]`.

## refactor
- **agentille-planner** — IF hasMultipleSubtasks, else skip
- **agentille-plan-reviewer** — IF the planner ran. Skip on `thinkingDepth=quick`.
- **agentille-executor**
- **agentille-code-reviewer** — REQUIRED — except for pure renames/moves with zero logic delta (files renamed/moved only), where it may be skipped. Refactors with any logic change still require it — regressions hide here. Tiered by diff size.
- *No design-reviewer* (refactor by definition has no visible change; if visual change emerges, that's the code-reviewer's BLOCKER finding)

## design
- **agentille-ui-prototyper** — REQUIRED. Frames the component design first (UI Prototype Blueprint) so the executor builds a deliberate, anti-generic design instead of improvising. Model per `model-routing.md`.
- **agentille-executor** — implements the visual change, building against the prototyper's Blueprint (passed in its dispatch prompt).
- **agentille-design-reviewer** — REQUIRED. Pass the clarified `viewports: [...]` (see `SKILL.md` → "Clarify before planning"). Model per `model-routing.md` — never downgrade.
- *Code-reviewer optional* — only if the design change required logic changes (state, handlers). For pure CSS/markup tweaks, skip. Tiered by diff size when run.

## debug
- **debug-loop** (agentille-executor): runs the executor's built-in Debugging discipline (`agents/agentille-executor.md`) — root cause before any fix, one hypothesis at a time, stop and question the architecture after 3 failed fixes. Surface the root cause, propose a fix.
- *No reviewers until a fix is applied — at which point promote to bugfix flow.*
- *Team mode (incident-team) follows the same promotion: after the surviving hypothesis lands a fix, the lead dispatches a one-shot code-reviewer on the diff — see `team-mode.md` → "Incident-team special case".*

## review
- **agentille-code-reviewer** — tiered by diff size; see `model-routing.md`. No executor (user is asking for review, not changes).
- **agentille-design-reviewer** — IF the target is UI code. Pass the clarified `viewports: [...]`.

## Hard cap

Never dispatch more than 3 executor subagents in parallel. If the plan has 5 parallel steps, batch them: 3 first, then 2.
