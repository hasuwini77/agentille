---
name: agentille-init
description: Optional setup for agentille. Asks up to 5 skippable questions (name/role, delivery style, tone, when to ask first, never-do list) and merges the answers into ~/.agentille/profile.json so agents sound like you. /agt works without it.
---

# agentille-init — optional voice profile

`/agt` runs fine with no profile at all. This skill only makes agents sound like you. Run it when the user asks to set up or update their agentille profile; never auto-trigger.

## Steps

1. Read `~/.agentille/profile.json` (`cat ... 2>/dev/null`). Absent → start from `{}`. Present but not valid JSON → tell the user to fix or delete it, and STOP; never overwrite a corrupt file.
2. Ask the questions below in one message. Each shows its current value (or the default) in brackets; an empty reply or "skip" keeps it.
   1. **name / role** — who are you, in a few words? `[current or skip]`
   2. **deliveryStyle** — `direct` | `detailed` | `step-by-step` | `short-paragraphs` `[direct]`
   3. **tone** — `peer-to-peer` | `mentor` | `formal` | `blunt` | `casual` `[peer-to-peer]`
   4. **preTaskQuestioning** — `never` | `ambiguous-only` | `always` `[ambiguous-only]`
   5. **neverDo** — things agents must never do, comma-separated `[none]`
3. **Merge, never replace.** Read-merge-write: load the profile, set only the fields the user answered, and write it back (2-space indent, trailing newline). Keep every other key untouched: unknown keys, `projects`, `routing`, `thinkingDepth`. Never write the file wholesale from scratch. Skipped questions write nothing.
4. Print the path and the resulting values in one short block. Re-running asks again with the saved values as defaults.

## Profile fields

| Field | Meaning | Default |
|---|---|---|
| `name`, `role` | who the agents work for | unset |
| `deliveryStyle` | `direct` / `detailed` / `step-by-step` / `short-paragraphs` | `direct` |
| `tone` | `peer-to-peer` / `mentor` / `formal` / `blunt` / `casual` | `peer-to-peer` |
| `preTaskQuestioning` | `never` / `ambiguous-only` / `always` | `ambiguous-only` |
| `neverDo` | list of hard prohibitions, passed to every agent | `[]` |
| `thinkingDepth` | `always` / `complex-only` / `quick`; edit by hand | `complex-only` |
| `routing` | `{autoFable, maxFablePerRun, fableWeeklyCeiling, advisorOnOpus}`; edit by hand | built-in |
| `viewports` | design-reviewer default, any of `desktop` / `tablet` / `mobile`; edit by hand | desktop + mobile |
| `projects[]` | repos registered by `/agentille-project` | `[]` |

Old profiles keep working: fields nobody reads are ignored, and there are no migrations.
