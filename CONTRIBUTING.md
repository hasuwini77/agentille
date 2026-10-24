# Contributing to agentille

Thanks for helping. This page is the short path from a clone to a merged pull request. The full guide (every module, the conventions, the release recipe, the privacy rules) is [.claude/CLAUDE.md](./.claude/CLAUDE.md). An AI agent working in this repo loads that file too, so read it before your first change.

## How the repo is laid out

- `skills/` holds the prompts: `skills/agt/` is the `/agt` orchestrator, `skills/storm/` is `/storm`, and the `agentille-*` folders are the optional setup skills.
- `agents/` holds the worker definitions (planner, executor, reviewers, adversary).
- `hooks/` holds the mod: the JavaScript Claude Code loads beside the skill. `register.js` only wires hooks to modules; each module owns one job (routing, panes, the guard, what is drawn).
- `docs/` holds the reference pages the README points at.
- `tests/mod/` holds the mod's tests, `tests/hooks/` the shell tests, `evals/` the dispatch-decision evals.

`.claude/CLAUDE.md` → "What lives where" lists every module and what it owns.

## Set up

1. Fork and clone the repo, then branch off `main` (`feat/<name>`, `fix/<name>` or `docs/<name>`).
2. Install the local pre-push hook once, so the validator runs before every push:
   ```bash
   ln -sf ../../scripts/hooks/pre-push .git/hooks/pre-push
   ```
3. To try your change in Claude Code, load the plugin from your clone and start a new session; the mod loads at session start.

## Run the checks

Three layers. Run the first two on every change.

- **Mod:** `claude plugin test .` runs every `tests/mod/*.test.ts` in an environment like the one the hooks run in. It exits 1 when a test fails. A test that walks the mock clock or boots a full session can take longer than the default limit on a busy machine: give it `{ timeoutMs: 20_000 }`.
- **Structural:** `bash scripts/validate.sh` is a linter. It checks version consistency, that agent roles, the routing table and the docs agree, that `→ "Section"` cross-references point at real headings, that every hook module imports on its own, and it scans tracked files for paths and emails. It also runs the shell tests in `tests/hooks/` (the session-end sweep, the update check, the guard and worktree script against a real git repo, tmux against a private server). Run one alone with `bash tests/hooks/<name>.sh`. A test that cannot run here prints `SKIP: <reason>`.
- **Behavioral:** the eval suite in `evals/` scores how `/agt` picks a level, roster and model. It is local and manual, never in CI, because every run spends your own credential. Run it before a change to `skills/agt/` or `hooks/routing.js`; the exact command is in `.claude/CLAUDE.md` → "Conventions".

If you run the shell tests from inside a git hook, unset `GIT_DIR` and `GIT_WORK_TREE` first. A hook exports them, and a test that makes a throwaway repo would then act on this one.

## How state works in the mod

Session state lives in stores, one per owning module. `store.js` `makeStore` hands the owner a writable record and every other module a read view that throws on assignment.

- A module writes only its own store, through the functions it exports for that (`setLastRun`, `clearFlags`, `applyDisplay`, …). Every other module calls those functions and never assigns.
- `state.js` re-exports each view (`Runs`, `Panes`, `Display`, `Profile`, …) and owns `Session` and `isLead()`.
- No module reads a view while it loads: the modules import one another in a cycle, so read inside a function.
- `seed()` writes past the transitions and is for tests only. The validator fails if a hook module calls it.
- On disk, the mod writes only under `~/.agentille/`: the profile when a setting is saved, and under `state/` the run folders and the lead's lists of the panes, sessions and worktrees it opened. The update-check script keeps its cache there too. A new file anywhere else needs a reason in the PR.

## What a good pull request looks like

- **One purpose.** A fix, a feature or a docs change, not all three. Split unrelated changes into separate PRs.
- **Atomic commits** in Conventional Commits form (`feat:`, `fix:`, `docs:`, `chore:` …), subject in the imperative and 70 characters or fewer, body saying why.
- **Tests with the change.** A behaviour change in `hooks/` comes with a test in `tests/mod/` that fails without it. A change to what the skill parses comes with a check in `tests/hooks/test-skill-text.sh`.
- **Docs that match.** If the README, a page in `docs/` or `.claude/CLAUDE.md` describes what you changed, update it in the same PR.
- **A `CHANGELOG.md` entry** under `## [Unreleased]`. Leave the version in `.claude-plugin/plugin.json` alone; it is bumped at release time.
- **No private data.** This repo is public. No personal names, emails, local paths, machine details, hostnames or private repo names, in code, commits or the PR description. Write generic examples ("a feature branch", "a private team repo").
- **The template filled in**, with the counts each check printed.

## Releases

Everything reaches `main` through a pull request. Releases follow a fixed cadence: one tag a day at most, fixes batched into the next minor, and nothing removed outside a major that deprecated it first. What each version number promises and how to pin one: [docs/releasing.md](./docs/releasing.md). The release steps themselves are in `.claude/CLAUDE.md` → "Release recipe".

## Reporting a bug or asking for a feature

Open an issue from one of the templates. For a bug, the Claude Code version (`claude --version`), the plugin version, the exact line you typed and what the card or band showed get it fixed fastest.
