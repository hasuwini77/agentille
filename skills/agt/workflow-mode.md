# Workflow tier — scripted fan-out without panes

Applies when the task has ≥2 disjoint slices, there is no pane transport, and the `Workflow` tool exists. A user-typed `/agt` satisfies the tool's opt-in. When the tool is absent, degrade silently to subagent waves: no message, same roster. The run dir is kept (`SKILL.md` → "The contract"); never delete it.

## Role → stage map

- executor: build stages, Sonnet (one per slice, at most 3 at once).
- code-reviewer: verify stages, model tiered per `routing.md` → "Review tiering".
- design-reviewer: Opus, on UI buckets only.
- security-reviewer: on security buckets (`risk=auth|money|data`) only.

Every stage prompt starts with the `[agt …]` header (`SKILL.md` → "Dispatch header").

## Adversarial verify

Verification stages do not trust the builder's claim. A verify stage re-runs the slice's check itself and tries to refute the result; a finding it cannot reproduce is dropped. P0/P1 go back to the executor (`mode=fix`), at most 2 rounds, then onto the card's `⚑`.

Load the `workflow-authoring` skill for the API.
