# Contributing to agentille (for humans and AI agents)

agentille is a **public, MIT-licensed Claude Code plugin** — the `/agt` orchestrator that turns one prompt into a tailored multi-agent run (planner, executor, reviewers) in the user's own voice. This file orients anyone — or any agent — working in this repo.

## What lives where

- `skills/agt/` — the orchestrator skill: `SKILL.md` (contract, mode table, dispatch header, hard rules), `routing.md` (category, roster, model + effort, escalation), `display.md` (mid-run lines, final card, report.md), `panes-mode.md`, `workflow-mode.md`, `formations.md`, `squads.md`.
- `skills/agentille-init/`, `skills/agentille-project/`, `skills/agentille-claude-md/` — optional setup skills (voice profile, per-repo CLAUDE.md, CLAUDE.md tune-up). `/agt` runs without any of them.
- `agents/agentille-*.md` — the eleven worker agent definitions (planner, plan-reviewer, ui-prototyper, executor, adversary, and six reviewers: code, design, security, payments, perf, seo).
- `.claude-plugin/` — `plugin.json` (version, bumped on every release), `marketplace.json` (listing metadata — no version field, do not version-bump it), `squads.json` (squad detection).
- `hooks/` — `hooks.json` (hook declarations + the mod module), `register.js` (the mod: live band, routing, pane tools, raw agent reports), `routing.js`, `panes.js`, `live.js`, `focus.js`, `highlight.js`, `squads.js`, `mascot.js` (the worker-pane mascot), and `agentille-update-check.sh` (version check, cached in `~/.agentille/.update-check.json`).
- `tests/mod/` — the mod's tests (`claude plugin test .`).
- `evals/` — the dispatch-decision eval suite (`evals/<case>/case.yaml`): four cases that score /agt's mode, roster, model and formation choices. Run results land in `evals/results/` (gitignored: transcripts hold absolute paths).

The plugin's "code" is **markdown prompt definitions** plus a small JavaScript mod, not a compiled program.

## How /agt picks a mode

Auto-detection is the **default**: the first matching row of `skills/agt/SKILL.md` → "Modes" wins, and anything unmatched goes to a one-call Haiku classify (`routing.md` → "Stage 2 classify"). Panes open only when ≥2 disjoint slices can build at once. The resolved mode + a one-clause reason is always printed on the recon line.

| What to type | Outcome |
|---|---|
| `/agt "task"` (no flags) | Auto-decides: solo (small one-sentence task, no architectural verb or risk words), subagent (sequential or single slice), panes inside Herdr or tmux for ≥2 disjoint slices (else a workflow, else subagent waves), or Stage 2 classify |
| `/agt "review …"` / `/agt "debug …"` | Subagent reviewers in parallel / the executor's debug loop |
| `/agt --mode panes\|subagent\|solo "task"` | **Force** a mode for one run |
| `/agt --team …` / `--mode team` | Removed in v3.0: prints one notice and resolves as if no flag was typed |

## Conventions

- **Commits:** Conventional Commits (`feat:`, `fix:`, `perf:`, `docs:`, `chore:` …), imperative subject ≤ 70 chars, body explains *why*.
- **Changelog:** record every notable change in `CHANGELOG.md` (`## [x.y.z] — YYYY-MM-DD`, with `### Added/Changed/Fixed/Rationale`). Do **not** add a `PROGRESS.md`.
- **Versioning:** bump `.claude-plugin/plugin.json` — feature → minor, fix → patch.
- **Verification has three layers.** *Behavioral* — `AGENTILLE_RAW_URL=file:///dev/null claude plugin eval . --runs 3 --ablation none --no-publish --max-cost-usd 5 --threshold 0.66`, run from a shell with no `HERDR_*` / `TMUX*` variables (unset them, or run outside Herdr and tmux): the case schema only accepts `EVAL_*` env keys, so pane-transport and update-check isolation must come from your shell. It scores mode, roster and model routing on 4 prompts. Local and manual only, never in CI: every run is a full claude child on your own credential. Cost: 4 cases × 1 run = $0.60 (measured on the smoke run; the full default run is priced in the release PR, and a 1-run figure is not its cost). `--no-publish` is mandatory, because the report otherwise publishes to claude.ai. `--ablation none`, because a no-plugin arm has no /agt. The first run asks to trust the folder. Run it before releasing a change to `skills/agt/` or `hooks/routing.js`. *Mod* — `claude plugin test .`. *Structural* — run `bash scripts/validate.sh` before every push (a `pre-push` hook and CI both run it). It is a linter, not a behavioral test: it checks version consistency (plugin.json ↔ CHANGELOG), that `marketplace.json` stays unversioned, that every `agentille:agentille-*` reference resolves to an agent file, that doc `→ "Section"` cross-refs point at real headings, that the hook script exists, and scans tracked files for PII (paths, emails). Install the local hook once: `ln -sf ../../scripts/hooks/pre-push .git/hooks/pre-push`.

## Release recipe

Features and fixes ship through a pull request, never a direct push to `main`.

1. On the feature branch, bump `version` in `.claude-plugin/plugin.json` (breaking → major, feature → minor, fix → patch). `marketplace.json` has no version field — do not touch it.
2. Add a dated `## [x.y.z] — YYYY-MM-DD` section to `CHANGELOG.md`.
3. Run `bash scripts/validate.sh`, `claude plugin validate . --strict` and `claude plugin test .` (the `pre-push` hook and CI run the validator too). When `skills/agt/` or routing changed, also run the eval suite (see Conventions → Verification) and report its score.
4. Commit `chore: release vx.y.z`, push, and open a PR (`gh pr create`, body with `Closes #N`).
5. On green: merge by PR number with a merge commit (`gh pr merge <N> --merge --delete-branch`), pull `main`, assert `jq -r .version .claude-plugin/plugin.json` is `x.y.z`, then `git tag vx.y.z && git push origin vx.y.z`.
6. Users pick it up with `claude plugin marketplace update hasuwini77-agentille && claude plugin update agentille@hasuwini77-agentille`.

## Hooks-test recipe

```bash
bash hooks/agentille-update-check.sh && cat ~/.agentille/.update-check.json
```

Expected: the cache file exists and holds a recent check timestamp and the latest known version.

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
