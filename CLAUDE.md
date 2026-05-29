# Contributing to agentille (for humans and AI agents)

agentille is a **public, MIT-licensed Claude Code plugin** — the `/agt` orchestrator that turns one prompt into a tailored multi-agent run (planner, executor, reviewers) in the user's own voice. This file orients anyone — or any agent — working in this repo.

## What lives where

- `skills/agt/` — the orchestrator skill: `SKILL.md` (contract + dispatch table), `classifier.md`, `roster.md`, `model-routing.md`, `team-mode.md`, `display.md`.
- `skills/agentille-init/`, `skills/agentille-project/` — setup skills (global profile, per-repo registration).
- `agents/agentille-*.md` — the seven worker agent definitions (planner, plan-reviewer, ui-prototyper, executor, code-reviewer, design-reviewer, security-reviewer).
- `.claude-plugin/` — `plugin.json` (version, bumped on every release), `marketplace.json` (listing metadata — no version field, do not version-bump it), and `teams/*.yaml` (team role manifests: `feature-team`, `review-team`, `incident-team`).
- `hooks/` — `hooks.json` (hook declarations), `agentille-update-check.sh` (version-check script, run by the hook), `agentille-log.md` (auto-appended by the script; gitignored if present).

The plugin's "code" is **markdown + YAML prompt definitions**, not a compiled program.

## How /agt picks a mode

Auto-detection is the **default**. Stage 1 checks a fast-path table (first match wins); anything that doesn't match falls to Stage 2, where the Opus planner classifies the task and picks the mode. Stage 2 promotes to `team` only when there are ≥2 genuinely disjoint slices that can build in parallel — paying ~4× tokens without real parallelism is the exact waste this orchestrator exists to avoid. The resolved mode + a one-clause reason is always printed on the recon ping / Mission Brief.

| What to type | Outcome |
|---|---|
| `/agt "task"` (no flags) | Auto-decides: solo (trivial / single file), subagent (sequential or single slice), review-team (verb = "review"), incident-team (verb = "debug"), or Stage 2 Opus classify for everything else |
| `/agt "review …"` | Auto → `review-team` (Stage 1 fast-path, verb match) |
| `/agt "debug …"` | Auto → `incident-team` (Stage 1 fast-path, verb match) |
| `/agt --team <template> "task"` | **Force** a named team (`feature-team`, `review-team`, `incident-team`); overrides auto and profile default. If the work lacks ≥2 disjoint slices, `/agt` asks to downgrade (or flags the trade if `preTaskQuestioning: never`) |
| `/agt --mode subagent "task"` | **Force** subagent mode for one run |

## Conventions

- **Commits:** Conventional Commits (`feat:`, `fix:`, `perf:`, `docs:`, `chore:` …), imperative subject ≤ 70 chars, body explains *why*.
- **Changelog:** record every notable change in `CHANGELOG.md` (`## [x.y.z] — YYYY-MM-DD`, with `### Added/Changed/Fixed/Rationale`). Do **not** add a `PROGRESS.md`.
- **Versioning:** bump `.claude-plugin/plugin.json` — feature → minor, fix → patch.
- **Verification has two layers.** *Behavioral* — there is no behavioral test framework for dispatch decisions (mode/roster/model selection live in the model, not in code) and one will not be added; validate those by running a representative task through `/agt` and describing what you ran. *Structural* — run `bash scripts/validate.sh` before every push (a `pre-push` hook and CI both run it). It is a linter, not a behavioral test: it checks version consistency (plugin.json ↔ CHANGELOG), that `marketplace.json` stays unversioned, that every `agentille:agentille-*` reference resolves to an agent file, that doc `→ "Section"` cross-refs point at real headings, that the hook script exists, and scans tracked files for PII (paths, emails). Install the local hook once: `ln -sf ../../scripts/hooks/pre-push .git/hooks/pre-push`.

## Release recipe

1. Bump the `version` field in `.claude-plugin/plugin.json` (feature → minor, fix → patch). `marketplace.json` has no version field — do not touch it.
2. Update `CHANGELOG.md` with a dated `## [x.y.z]` section.
3. Run `bash scripts/validate.sh` — it catches the classic release mistakes (CHANGELOG/plugin.json version drift, an accidental `marketplace.json` version). The `pre-push` hook + CI run it too, but checking here saves a round-trip.
4. Commit: `chore: release vx.y.z`.
5. Push `main`. Users re-run `/plugin install agentille` to pick up the new version.

## Hooks-test recipe

```bash
bash hooks/agentille-update-check.sh
```

Expected: a version-check line appended to `hooks/agentille-log.md`. Open the file to confirm the entry is present and timestamped.

## Privacy & OSS hygiene — read this before you commit

This is a **public repository**. Treat every commit, diff, file, CHANGELOG entry, comment, and PR body as world-readable forever. **Never commit personal or private data**, including:

- Real names, emails, or handles of individuals (the `@`-author in `plugin.json` is the intentional public maintainer identity — that's the only exception).
- An employer, organization, customer, or domain/industry reference.
- **Private or external repository names**, and **infra hostnames, remotes, URLs, or usernames** (e.g. internal Git remotes).
- Local filesystem paths, machine details, tokens, or secrets.
- Internal conversational framing or session context (how a feature was discussed, nicknames, "the wow effect", etc.).

**Genericize all examples.** Write "a private team repo", "a feature branch", "a non-GitHub remote", "a large `node_modules` tree" — never the real identifiers.

**Where private/working docs go:** brainstorming specs, implementation plans, and any doc that references external or private context belong **outside the tree** in `~/.agentille/specs/` and `~/.agentille/plans/`. As a safety net, `docs/superpowers/` and `docs/agentille/` are gitignored — but the rule is *genericize regardless of location*, because gitignore is one `git add -f` away from leaking.

**Before pushing:** scan the diff. A quick guard:
```bash
git log -p origin/main..HEAD | grep -inE "<your-private-names>|<hostnames>|/home/|@.*\.(com|mil|gov|io)"
```
If anything private appears, do not push — scrub history first.

Personal, machine-local instructions go in `CLAUDE.local.md` (gitignored), never in this file.
