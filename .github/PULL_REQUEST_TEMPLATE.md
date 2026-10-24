## What changed and why

What a user or a contributor sees differently after this PR, and the reason for it.

Closes #

## Verification

Each layer you ran, with the counts it printed. Say why when one was skipped.

- [ ] Structural: `bash scripts/validate.sh` → _ fail(s), _ warning(s)
- [ ] Mod: `claude plugin test .` → _ pass, _ fail
- [ ] Behavioral (needed for changes to `skills/agt/` or `hooks/routing.js`): the eval suite → _ of _ cases passed

## Checklist

- [ ] A `CHANGELOG.md` entry under `## [Unreleased]`
- [ ] No private data: no personal names, emails, local paths, machine details, hostnames or private repo names in the diff, the commits or this description
- [ ] Commits follow Conventional Commits (`feat:`, `fix:`, `docs:` …), one logical change each, subject 70 characters or fewer
- [ ] Docs updated where the behaviour they describe changed (README, `docs/`, `.claude/CLAUDE.md`)
