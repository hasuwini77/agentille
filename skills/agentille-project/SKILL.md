---
name: agentille-project
description: Register the current repo with agentille and write its ./CLAUDE.md. Asks 7 short per-repo questions, appends the project to ~/.agentille/profile.json's projects[] and renders a per-repo CLAUDE.md using your voice settings. Optional; /agt works without it.
---

# agentille-project — per-repo registration

Run inside a repo to register it and seed its `./CLAUDE.md`. Never auto-trigger.

## Steps

1. **Profile.** If `~/.agentille/profile.json` is absent, continue with `{}` (voice lines are then omitted from the CLAUDE.md). If it exists but is not valid JSON, stop and tell the user.
2. **Existing `./CLAUDE.md`.** If present, ask: keep it or overwrite? Skip the render on keep (still register the project). Never overwrite without an explicit yes.
3. **Ask once, in one message, each with a default:**
   1. **name** (directory basename)
   2. **description** (one line)
   3. **techStack** (free-form list; offer what you detect from the repo)
   4. **goals**
   5. **claudeUse** — how Claude is used here
   6. **constraints** — rules Claude must respect
   7. **integration** — where finished work lands: `pr` (open a PR), `push` (push my feature branch, no merge), `local` (no remote)
4. **Register.** Read-merge-write `~/.agentille/profile.json`: append to `projects[]`, or replace the entry with the same `id`. Touch nothing else in the file.

   ```json
   { "id": "<slug>", "name": "", "description": "", "techStack": [], "goals": "",
     "claudeUse": "", "constraints": "", "integration": "pr | push | local" }
   ```

   Slug: lowercase, non-alphanumeric to `-`, trimmed; empty → `project-<random>`.
5. **Render** `./CLAUDE.md` from `claude-md-template.md`, pulling `name`, `deliveryStyle`, `tone`, `neverDo` from the profile.
6. **Write** `./.agentille/config.json` as `{ "integration": "<chosen>" }` (repo-local, authoritative for this repo's runs). Print the three paths and suggest adding `.agentille/` to `.gitignore` if it should not be committed.

## Hard rules

- Never overwrite a file without explicit confirmation.
- Never change the profile's voice settings; this skill is project-scoped.
- Never commit `~/.agentille/profile.json`.
