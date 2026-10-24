# Contributing to agentille (for humans and AI agents)

agentille is a **public, MIT-licensed Claude Code plugin** — the `/agt` orchestrator that turns one prompt into a tailored multi-agent run (planner, executor, reviewers) in the user's own voice. This file orients anyone — or any agent — working in this repo.

## What lives where

- `skills/agt/` — the orchestrator skill: `SKILL.md` (contract, level table, dispatch header, hard rules), `routing.md` (category, roster, model + effort, escalation), `factory.md` (`/agt next`, fix rounds, gate, integrate), `display.md` (mid-run lines, final card, report.md), `panes-mode.md`, `workflow-mode.md`, `formations.md`, `squads.md`.
- `skills/storm/` — `/storm`: research lenses, scoring and the hand-off to `/agt heavy`.
- `skills/agentille-init/`, `skills/agentille-project/`, `skills/agentille-claude-md/` — optional setup skills (voice profile, per-repo CLAUDE.md, CLAUDE.md tune-up). `/agt` runs without any of them.
- `agents/agentille-*.md` — the eleven worker agent definitions (planner, plan-reviewer, ui-prototyper, executor, adversary, and six reviewers: code, design, security, payments, perf, seo).
- `.claude-plugin/` — `plugin.json` (version, bumped on every release), `marketplace.json` (listing metadata — no version field, do not version-bump it), `squads.json` (squad detection).
- `hooks/` — `hooks.json` (hook declarations + the mod module) and the mod, about 8k lines over 41 modules:
  - `register.js` — the entry: wiring only, about 320 lines. Each hook handler is a few lines that call into a module; the pane tool handlers live in `tools.js` (`spawn_pane`, `open_sessions`, `close_pane`), and the prompt.submit and turn.complete bodies in `turns.js` (`onPromptSubmit`, `onTurnComplete`). Session state lives in stores, each owned by the module that writes it: `store.js` `makeStore` gives the owner its writable record and everyone else a read view that throws on assignment. A module writes only its own store, through its transitions (`setLastRun`, `addRoute`, `noteWire`, `clearFlags`, `ownName`, …); every other module calls those, never assigns. `state.js` is the index: it owns the `Session` store (who this session is: worker or lead, its pane name, ids and versions, the lead's turn) and `isLead()` (the one lead/worker predicate), and re-exports each owner's view (`Proofs` proofs.js, `Runs` dispatch.js, `Spawn` spawn.js, `Panes` reaper.js, `Sessions` sessions.js, `Profile` profile.js, `Display` display.js, `Wire` worker.js, `Timers` ticker.js, `Worktrees` guard-own.js) and `ctx`. No module reads a view at load time (the modules import one another in a cycle); `seed()` writes past the transitions for tests only. `proofs.js` owns the `Proofs` store and every typed-proof transition (`typedPrompt`, `startRun`, `endRun`, `dropProof`, `agtTurnStart`, `agtTurnFromDispatch`, `setRunProfile`) and the gates that read them (`spawnAllowed`, `sessionsAllowed`, `fableProof`, `inFlight`, `runHeld`); `text.js` holds the long model-facing strings (tool descriptions, the pane rule) as wrapped parts; `panerec.js` holds what the lead keeps about each pane (one record per pane id: seen, first seen, harvested, wire done, woken, told stranded; and the name-keyed stage, resting sessions and stranded set), with one `forget`.
  - What a run does: `dispatch.js` (per-run counters, routing log, ledger, raw reports, the executor-count flag and the once-per-run cost-ceiling toast), `routing.js` (the model + effort TABLE, the Fable guard, the `quick` rules, the executor cap and the `maxRunUsd` price estimate), `spawn.js` (pane transport, opening a worker pane, lazy tool registration, the lead's ownership list in `~/.agentille/state/lead-<pane>.panes`), `trust.js` (folder trust: whether an agt/* worktree's project config, and what it runs or imports, is the lead checkout's), `sessions.js` (the person's own panes), `reaper.js` (pane polling, harvest, close, `/agt-clean`; acts only on panes this session opened, by name, and the git tidy only on worktrees its runs made), the guard in four files — `guard.js` (the Bash hook `bashCall`, the Write/Edit/MultiEdit/NotebookEdit hooks, the profile snapshot, and the re-exports so `./guard.js` still carries the whole surface), `guard-lex.js` (the shell lexer: words, `expand`, wrappers, heredocs/interpreters, `commandSteps`/`codeStep`, and the protected-path reader), `guard-policy.js` (the integration mode for the repo a command targets, `judgePush`/`ghStep`/the curl and API judgements, the script/recipe readers and the deny texts) and `guard-own.js` (worktree ownership records, `newTrees`, `ownedWorktrees`) — which read each line as the shell would, see through wrappers, interpreters, aliases and scripts they read first, judge merges, tags, releases, API merges, ref writes, local base rewrites and pushes by effect in the repo the write lands in (the mode looked up by remote URL or path, never raised above the snapshot taken at the typed /agt), refuse writes to the trust root and the repo's git state, fail closed, and record the run's worktrees in `~/.agentille/state/lead-<pane>.worktrees`; `worker.js` + `wire.js` (the wire between panes), `ticker.js` (timers), `squads.js`, `skew.js` (installed-version drift), `profile.js` (session load).
  - What you see: `render.js` (switchboard, deck, answer frame, mascot band), `display.js` + `settings.js` (the `display` settings: deck, focus, highlight, and the band, statusLine and mascot switches), `drawing.js`, `tree.js`, `rows.js`, `board.js`, `live.js`, `status.js`, `focus.js`, `highlight.js`, `links.js`, `mascot.js`, `autocomplete.js`, `info.js` (`/agt-info`), `clean.js` (the `/agt-clean` text), `panes.js` (pane tool input parsing).
  - Shell: `agentille-sweep.sh` (SessionEnd sweep: closes only the panes listed in this lead's `lead-<pane>.panes` whose answer is saved, and the idle sessions in `lead-<pane>.sessions`) and `agentille-update-check.sh` (version check, cached in `~/.agentille/.update-check.json`).
- `docs/` — reference pages the README links to instead of carrying: `releasing.md` (cadence, what each version promises, pinning), `settings.md` (the display switches, the `display.highlight` detail and the older settings commands), `glossary.md` (the words the README uses, one meaning each), `guards.md` (the merge/push guards and what unlocks the pane tools), `sessions.md` (the person's own panes), `display.md` (the switchboard, transcript rows and pane-worker detail) and `routing-cost.md` (the `maxRunUsd` price table and estimate). Keep the README to onboarding; reference detail goes here with a one-line pointer.
- `tests/mod/` — the mod's tests (`claude plugin test .`). `tests/hooks/` — shell tests run by `scripts/validate.sh`: the two hook scripts (`test-sweep.sh`, `test-sweep-parity.sh`, `test-update-check.sh`), the validator itself (`test-validate-gate.sh`), the minimum Claude Code version (`test-min-version.sh`), the real-git checks that `tests/mod/` cannot run (`test-guard-real.sh` drives the guard against a real repo and bare origin; `test-agt-worktree.sh` runs `scripts/agt-worktree.sh` and the tidy on a real repo), the real-tmux check (`test-tmux-real.sh` drives spawn_pane and close_pane against a private tmux server with a placeholder worker; a test that cannot run prints `SKIP: <reason>` and exits 3, a WARN locally and a FAIL under CI=true) and the prompt files (`test-skill-text.sh`: size, the tokens the lead parses, and that values one file hands over, like the slice branch, read the same where they are used).
- `evals/` — the dispatch-decision eval suite (`evals/<case>/case.yaml`): four cases that score /agt's mode, roster, model and formation choices. Run results land in `evals/results/` (gitignored: transcripts hold absolute paths).

The plugin's "code" is **markdown prompt definitions** (28 skill and agent files) plus the JavaScript mod in `hooks/`, not a compiled program.

## How /agt picks a level

Auto-detection is the **default**: the first matching row of `skills/agt/SKILL.md` → "Levels" wins, and anything unmatched goes to a one-call Haiku classify (`routing.md` → "Stage 2 classify"). Panes open only when ≥2 disjoint slices can build at once. The resolved level + a one-clause reason is always printed on the recon line.

| What to type | Outcome |
|---|---|
| `/agt "task"` (no flags) | Auto-decides: low · solo (small one-sentence task, no architectural verb or risk words), low or medium · subagent (sequential or single slice, or 2–3 small disjoint slices), heavy · panes inside Herdr or tmux for ≥2 disjoint slices (else a workflow, else subagent waves), or Stage 2 classify |
| `/agt "review …"` / `/agt "debug …"` | Subagent reviewers in parallel / the executor's debug loop |
| `/agt low\|medium\|heavy "task"` | **Force** a level for one run |
| `/agt --mode panes\|subagent\|solo` · `--team` | Deprecated: `--mode` maps to heavy/medium/low, is never suggested and goes away in v4; `--team` was removed in v3.0 and prints one notice |

## Conventions

- **Commits:** Conventional Commits (`feat:`, `fix:`, `perf:`, `docs:`, `chore:` …), imperative subject ≤ 70 chars, body explains *why*.
- **Changelog:** record every notable change in `CHANGELOG.md` (`## [x.y.z] — YYYY-MM-DD`, with `### Added/Changed/Fixed/Rationale`). Do **not** add a `PROGRESS.md`.
- **Versioning:** bump `.claude-plugin/plugin.json` — feature → minor; fixes batch into the next minor, and a patch is only for a regression in the newest minor (`docs/releasing.md`). A `fix:` commit on `main` is not a release.
- **Verification has three layers.** *Behavioral* — `AGENTILLE_RAW_URL=file:///dev/null claude plugin eval . --runs 3 --ablation none --no-publish --max-cost-usd 5 --threshold 0.66`, run from a shell with no `HERDR_*` / `TMUX*` variables (unset them, or run outside Herdr and tmux): the case schema only accepts `EVAL_*` env keys, so pane-transport and update-check isolation must come from your shell. It scores mode, roster and model routing on 4 prompts. Local and manual only, never in CI: every run is a full claude child on your own credential. Cost: 4 cases × 3 runs = $1.81 (measured at v3.8.0; it varies with model and prompt length). `--no-publish` is mandatory, because the report otherwise publishes to claude.ai. `--ablation none`, because a no-plugin arm has no /agt. The first run asks to trust the folder. Run it before releasing a change to `skills/agt/` or `hooks/routing.js`. *Mod* — `claude plugin test .`. *Structural* — run `bash scripts/validate.sh` before every push (a `pre-push` hook and CI both run it). It is a linter, not a behavioral test: it checks version consistency (plugin.json ↔ CHANGELOG), that `marketplace.json` stays unversioned, that every `agentille:agentille-*` reference resolves to an agent file, that `squads.json` parses and every role it adds has an agent file, that agent roles, the `routing.js` TABLE and `routing.md` rows are the same set, that every `hooks.json` module exists, that `hooks/register.js` and every other `hooks/*.js` module, each on its own, import cleanly under node 22.7+ (WARN where node is missing or older), that no hooks module calls the tests-only `store.js` `seed()`, that doc `→ "Section"` cross-refs point at real headings, that the README's `## Routing` table is a copy of `routing.md` → "Default routing", that the failed-fix count before Fable agrees across `hooks/routing.js`, `routing.md`, the README and the `/agt-info` rung label in `hooks/info.js`, that the hook script exists, and scans tracked files for PII (paths, emails). Install the local hook once: `ln -sf ../../scripts/hooks/pre-push .git/hooks/pre-push`.

## Release recipe

Features and fixes ship through a pull request, never a direct push to `main`. Cadence and what each bump promises: `docs/releasing.md` (one tag a day at most, fixes batch into the next minor, removals only in a major after a deprecation).

1. On the feature branch, bump `version` in `.claude-plugin/plugin.json` (breaking → major, feature or batched fixes → minor, a regression in the newest minor → patch). `marketplace.json` has no version field — do not touch it. Fixes that ship without a version bump go under `## [Unreleased]` in `CHANGELOG.md` and fold into the next minor's section.
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
