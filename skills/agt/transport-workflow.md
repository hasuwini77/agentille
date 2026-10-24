# Workflow tier — scripted fan-out without panes

Applies on the heavy level when there is no pane transport and the `Workflow` tool exists. A user-typed `/agt` satisfies the tool's opt-in. When the tool is absent, degrade silently to subagent waves: no message, same roster. The run dir is kept (`SKILL.md` → "The contract"); never delete it.

## Role → stage map

- executor: build stages, Sonnet (one per slice, at most 3 at once).
- code-reviewer: verify stages, model tiered per `routing.md` → "Review tiering".
- design-reviewer: Opus, on UI slices only.
- security-reviewer: on security slices (`risk=auth|money|data`) only.

Every stage prompt starts with the `[agt …]` header (`SKILL.md` → "Dispatch header"). The lead must name the routed model in the workflow script: the mod cannot rewrite a workflow agent's model, so it refuses one whose script names another model than the routed pick (`agt ✗ workflow <role> asks <model>, routed <model> · <effort>: …`). Give each `agent()` the model from `routing.md` → "Default routing" yourself (past `maxRunUsd`, the demoted pick); on that refusal, rewrite the script with the routed model and run it again. An `agent()` that names no model runs the engine's default, which the mod logs and toasts when it differs from the table. A stop (`routing.stopAtCeiling` past `maxRunUsd`, or `routing.stopAtWeeklyPct`) denies the workflow agent like any other dispatch.

## Adversarial verify

Verification stages do not trust the builder's claim. A verify stage re-runs the slice's check itself and tries to refute the result; a finding it cannot reproduce is dropped. P0/P1 go back to the executor (`work=fix`), at most 2 rounds, then onto the card's `⚑`.

Load the `workflow-authoring` skill for the API.
