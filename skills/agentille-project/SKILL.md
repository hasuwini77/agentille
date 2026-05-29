---
name: agentille-project
description: Register the current repo with agentille and write its `./CLAUDE.md`. Runs inside any repo after the global profile is set up via `agentille-init`. Asks 7 per-repo questions (name, description, tech stack, goals, Claude-use, constraints, integration target), appends the project to ~/.agentille/profile.json's `projects[]` array, and renders a per-repo CLAUDE.md inheriting the user's global voice settings.
---

# agentille-project — per-repo registration

Run this skill **inside any repo** to add it to the user's agentille profile and seed its `./CLAUDE.md`.

## Preconditions

- `~/.agentille/profile.json` must exist (created by `agentille-init`).
- If it doesn't, stop and tell the user: *"No global profile found. Run `agentille-init` first, then come back."*

## When to invoke

- User says "register this repo with agentille" / "run agentille project" / "set up CLAUDE.md for this project"

Do NOT auto-trigger.

## What to do

1. **Verify profile exists:**

   ```bash
   ls ~/.agentille/profile.json
   ```

   If missing, stop with the message above.

2. **Detect existing `./CLAUDE.md`** in the current working directory:

   - If it exists, ask: *"`./CLAUDE.md` already exists. Overwrite, or keep it?"*
   - Only proceed on explicit overwrite.

3. **Ask the 7 project questions:**

   1. **name** — *Project name?* (default: current directory basename)
   2. **description** — *One-line description?*
   3. **techStack** — *Tech stack?* (multi-select; same list as in `agentille-init/profile-schema.md` → `TECH_STACK_OPTIONS`)
   4. **goals** — *What are you trying to achieve with this project?*
   5. **claudeUse** — *How do you use Claude on this project?*
   6. **constraints** — *Any constraints / rules Claude should respect?*
   7. **integration** — *When work finishes here, where does it land?* (single-select)
      - `pr` — open a PR (typically to `main`); the insta-PR-to-main flow.
      - `push` — push my own feature branch; don't merge to `main` yet.
      - `local` — keep it local; no remote.

4. **Build a `WizardProject` object** and append to `profile.json` (or replace by `id` if the slug already exists in `projects[]`):

   ```json
   {
     "id": "<slug-of-name>",
     "name": "...",
     "description": "...",
     "techStack": ["..."],
     "goals": "...",
     "claudeUse": "...",
     "constraints": "...",
     "integration": "pr | push | local"
   }
   ```

   Slug rule: lowercase, non-alphanumeric → `-`, trim leading/trailing `-`. Fallback if empty: `project-<uuid>`.

5. **Render `./CLAUDE.md`** using the template in `claude-md-template.md`. Pull voice settings from the global profile (`deliveryStyle`, `tone`, `honestyLevel`, `neverDo`, `customNeverDo`).

6. **Write all three files:**

   - `~/.agentille/profile.json` (updated, 2-space indent + newline)
   - `./CLAUDE.md` (rendered)
   - `./.agentille/config.json` — `{ "integration": "<chosen>" }` (repo-local; authoritative for this repo's runs, travels with the repo)

7. **Confirm** with the user: print all three paths. Also suggest: *"If you don't want `.agentille/` committed, add it to this repo's `.gitignore`."*

## Hard rules

- Never overwrite without explicit confirmation.
- Never modify the global profile's voice settings (`deliveryStyle`, etc.) — this skill is project-scoped only.
- Never commit `~/.agentille/profile.json` from anywhere.
