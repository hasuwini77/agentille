# Contributing to agentille (for humans and AI agents)

agentille is a **public, MIT-licensed Claude Code plugin** — the `/agt` orchestrator that turns one prompt into a tailored multi-agent run (planner, executor, reviewers) in the user's own voice. This file orients anyone — or any agent — working in this repo.

## What lives where

- `skills/agt/` — the orchestrator skill: `SKILL.md` (contract + dispatch table), `classifier.md`, `roster.md`, `model-routing.md`, `team-mode.md`, `display.md`.
- `skills/agentille-init/`, `skills/agentille-project/` — setup skills (global profile, per-repo registration).
- `agents/agentille-*.md` — the six worker agent definitions (planner, plan-reviewer, executor, code-reviewer, design-reviewer, security-reviewer).
- `.claude-plugin/` — `plugin.json` (version) and `teams/*.yaml` (team manifests).
- `hooks/` — runtime hooks.

The plugin's "code" is **markdown + YAML prompt definitions**, not a compiled program.

## Conventions

- **Commits:** Conventional Commits (`feat:`, `fix:`, `perf:`, `docs:`, `chore:` …), imperative subject ≤ 70 chars, body explains *why*.
- **Changelog:** record every notable change in `CHANGELOG.md` (`## [x.y.z] — YYYY-MM-DD`, with `### Added/Changed/Fixed/Rationale`). Do **not** add a `PROGRESS.md`.
- **Versioning:** bump `.claude-plugin/plugin.json` — feature → minor, fix → patch.
- **Verification is behavioral.** There is no unit-test framework and one will not be added. Validate changes by running a representative task through `/agt` and observing the result; describe what you ran.

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
