---
name: agentille-init
description: One-time global setup for agentille. Captures the user's communication, thinking, and identity preferences in 18 questions across 3 sections, then writes ~/.agentille/profile.json. Run this once per machine before using `/agentille <task>`. The master orchestrator skill (`agentille`) reads the profile to dispatch subagents in the user's voice.
---

# agentille-init — global profile setup

Run this skill **once per machine** to capture the user's preferences. It writes `~/.agentille/profile.json`, which every other agentille skill reads to apply the user's voice.

## When to invoke

- User explicitly asks to "set up agentille", "run agentille init", or "configure my agentille profile"
- The master `agentille` skill detected a missing profile and asked the user to run init
- Profile exists but user wants to update it (you'll detect the existing file and ask to overwrite)

Do NOT auto-trigger on generic setup prompts.

## What to do

1. **Check if a profile exists:**

   ```bash
   ls ~/.agentille/profile.json 2>/dev/null
   ```

   If it exists, ask the user: *"A profile already exists at `~/.agentille/profile.json`. Overwrite, or keep it?"* — only proceed on explicit overwrite.

2. **Ask the 18 questions** in `questions.md` — three sections of 6-ish, with progress markers ("Step 1 of 3 — Identity").
   - Use Claude Code's natural conversation flow (one question at a time, or grouped 3-4 if the user prefers).
   - For multi-select fields (`techStack`, `useCases`, `neverDo`), present the option list and accept comma-separated answers or numbered picks.
   - For enum fields (`deliveryStyle`, `tone`, `honestyLevel`, etc.), show all options with their hints and ask the user to pick.

3. **Build the profile object** matching `profile-schema.md`.

4. **Write the file:**

   ```bash
   mkdir -p ~/.agentille
   ```

   Then write the JSON to `~/.agentille/profile.json` (2-space indent, trailing newline).

5. **Confirm with the user** by printing the path and the next step:
   - *"Profile written to `~/.agentille/profile.json`."*
   - *"Run `agentille-project` inside any repo to add it to your profile and generate its `./CLAUDE.md`."*
   - *"Then use `/agentille <task>` in Claude Code to orchestrate work."*

## Hard rules

- **Do not invent answers.** Every field must come from the user. If the user says "skip", record an empty string or empty array, not a guess.
- **Do not save to a custom path.** The path is always `~/.agentille/profile.json` — the master orchestrator looks there.
- **Validate enum picks.** If the user picks an option not in the list, re-prompt — don't silently accept invalid values.
- **Never commit the profile file.** It contains personal preferences. Add `.agentille/` to the user's global `.gitignore` if missing.
