---
name: agentille-init
description: Global setup for agentille — idempotent by default. Captures communication, thinking, and identity preferences in 22 questions across 4 sections, then writes ~/.agentille/profile.json. Re-running only asks for fields not yet set. Use --reconfigure to re-ask everything. The master orchestrator skill (`agt`) reads the profile to dispatch subagents in the user's voice.
---

# agentille-init — global profile setup

Run this skill to capture the user's preferences. It writes `~/.agentille/profile.json`, which every other agentille skill reads to apply the user's voice. Safe to re-run — it only asks for what's missing.

## When to invoke

- User explicitly asks to "set up agentille", "run agentille init", or "configure my agentille profile"
- The master `agt` skill detected a missing profile and asked the user to run init
- Profile exists but user wants to update specific answers (idempotent re-run, fills gaps only)
- User passes `--reconfigure` to redo the full wizard

Do NOT auto-trigger on generic setup prompts.

## Invocation & flags

| Flag | Behavior |
|---|---|
| _(none)_ | **Idempotent merge** — read the existing profile, ask only for fields whose keys are absent. If nothing is missing, print the "already complete" message and stop. |
| `--reconfigure` | **Full re-ask** — re-ask all questions across all 4 sections, showing each existing value as the current default. User keeps or changes each answer. Always preserves `projects[]` and `selectedPrompts[]` — those are not wizard fields and must never be wiped. |

The `--reconfigure` token is read from the skill's invocation arguments. If it appears anywhere in the invocation, use full re-ask mode; otherwise use the default idempotent mode.

## What to do

### (a) Read existing profile

```bash
cat ~/.agentille/profile.json 2>/dev/null
```

- If absent → treat EXISTING as `{}` (fresh install, everything is missing, ask all questions).
- If present and valid JSON → parse it as EXISTING.
- If present but **malformed JSON** → tell the user ("Profile file exists but is not valid JSON — fix or delete `~/.agentille/profile.json` before re-running.") and **STOP immediately. Never clobber a corrupt-but-present profile.**

### (b) Decide which questions to ask

**Default (no flag):**
Apply the **key-presence rule**: a field is "already answered" if its key exists in EXISTING — even if the value is an empty string or empty array. The user previously chose to leave it blank; don't re-ask.

Ask only fields whose keys are **absent** from EXISTING.

Check presence against the canonical `WIZARD_KEYS` list in `profile-schema.md` — not against whatever happens to be in EXISTING. (`projects`, `selectedPrompts`, and `schemaVersion` are system-owned and are never "asked".)

Key-presence applies to the nested `team.*` fields too: if the `team` object is absent **or** present-but-missing a sub-field (`enabled`, `defaultMode`, `maxTeammates`), ask the missing team question(s). A v1.0/v1.1 profile lacks `team` entirely → ask **only** the 3 Section 4 team questions.

**When nothing is missing:**
- If every `WIZARD_KEYS` field is present AND `schemaVersion` already equals the current value (`2`) → print *"Your profile is already complete (schemaVersion 2). Run `agentille-init --reconfigure` to redo it."* and **stop without rewriting**.
- If every field is present but `schemaVersion` is absent or older (e.g. a hand-crafted profile) → do a **migration-only write**: stamp `schemaVersion: 2` and save without asking anything. Report *"Profile already complete — stamped schemaVersion 2."* (This is the one case where a "complete" profile is still rewritten.)

**`--reconfigure` flag:**
Re-ask every question in all 4 sections, showing each existing value as the current default. "Keep" (the user presses enter or says "same") retains the existing value; to **clear** a field the user must say so explicitly ("clear" / "none") → record empty. Do not treat a bare "skip" as clear during reconfigure — when in doubt, keep. On a fresh install (EXISTING is `{}`) there are no defaults to show — run it as a normal first-time setup.

Show a section header only for sections that actually have questions. If just one section is being asked (e.g. only Section 4 on a v1.0 upgrade), use its plain title ("Team mode") **without** the "N of 4" counter — that counter implies prior sections the user never sees.

### (c) Ask the selected questions

- Use Claude Code's natural conversation flow — one question at a time, or grouped 3–4 if the user prefers.
- For multi-select fields (`techStack`, `useCases`, `neverDo`), present the option list and accept comma-separated answers or numbered picks. **Store the option `id` for `useCases` and `neverDo`** — their options are `{ id, label }` objects, so store ids (`"coding"`, `"no-disclaimers"`), not labels. `techStack` options are plain strings — store them as-is.
- For enum fields (`deliveryStyle`, `tone`, `honestyLevel`, etc.), show all options with their hints and ask the user to pick.
- Validate enum picks — if the user picks a value not in the list, re-prompt. Do not silently accept invalid values.
- If the user says "skip", record an empty string or empty array for that field.

### (d) Merge answers into EXISTING

- Start from EXISTING as the base object.
- Overlay only the fields that were just answered.
- **Never drop keys you didn't ask about** — this includes `projects`, `selectedPrompts`, and any future keys added by other skills.
- If the `team` section was newly answered (Section 4 was asked), write all five team fields: `enabled`, `defaultMode`, `maxTeammates`, plus defaults `displayMode: "auto"` and `dailySoftCap: 10`.

### (e) Stamp schemaVersion

Set `schemaVersion: 2` on the merged object before writing.

### (f) Write the file

```bash
mkdir -p ~/.agentille
```

Write the merged JSON to `~/.agentille/profile.json` — 2-space indent, trailing newline.

### (g) Confirm

Print:
- *"Profile written to `~/.agentille/profile.json`."*
- A one-line summary of what happened — one of:
  - *"Asked N missing fields."*
  - *"Full reconfigure — all fields updated."*
  - *"Already complete — nothing to do."* (only printed in step b when stopping early)
- Next steps:
  - *"Run `agentille-project` inside any repo to add it to your profile and generate its `./CLAUDE.md`."*
  - *"Then use `/agt <task>` in Claude Code to orchestrate work."*

## Hard rules

- **Idempotent by default.** Never re-ask a field whose key already exists in EXISTING. Never overwrite existing values unless `--reconfigure` was passed. Never wipe `projects[]` or `selectedPrompts[]` under any circumstances.
- **`--reconfigure` preserves non-wizard keys.** Even on full re-ask, merge back onto EXISTING — don't build a blank object. This protects `projects`, `selectedPrompts`, and any future keys.
- **Do not invent answers.** Every field must come from the user. If the user says "skip", record an empty string or empty array, not a guess.
- **Do not save to a custom path.** The path is always `~/.agentille/profile.json` — the master orchestrator looks there.
- **Validate enum picks.** If the user picks an option not in the list, re-prompt — don't silently accept invalid values.
- **Never commit the profile file.** It contains personal preferences. Add `.agentille/` to the user's global `.gitignore` if missing.
- **Stop on malformed JSON.** If the existing file cannot be parsed, halt and tell the user. Do not overwrite.
