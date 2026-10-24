# Releasing agentille

How often agentille ships, what each version number promises, and what a user who pins a tag can expect. The mechanics (bump, changelog, PR, tag) are in `.claude/CLAUDE.md` → "Release recipe"; this page is the policy those steps follow.

## Cadence

- **One tag per day at most.** Fixes found after a release wait for the next one and ship together. A second tag on the same day needs a reason in its CHANGELOG entry (a release that breaks `/agt` for everyone, or a leaked secret).
- **Batch fixes into the next minor.** A `fix:` commit on `main` is not a release. Patch versions (`x.y.Z`) are for a regression in the newest minor that stops a run; everything else rides the next `x.Y.0`.
- **A quiet week is fine.** No release is due because time passed. Users on `claude plugin update` see a version only when it carries a change they would notice.

## What a version number promises

| Bump | When | What a pinned user can rely on |
|---|---|---|
| patch `x.y.Z` | a regression in the newest minor | nothing changes but the fix |
| minor `x.Y.0` | a feature, a new default that only loosens, a doc or skill change | every `/agt` line, `/agt-*` command, tool name, profile key and header field still works |
| major `X.0.0` | anything removed or renamed, a default that tightens behaviour, a changed file layout under `~/.agentille` | the CHANGELOG "Removed" section lists each item with its replacement |

## Removing things

1. A command, flag, profile key or tool is **deprecated in a minor** first: it keeps working, its help text says what replaces it and in which major it goes away, and the CHANGELOG lists it under "Deprecated".
2. It is **removed in the next major**, never in a minor or patch. The "Removed" section names the replacement again.
3. One major at most per quarter. Two majors in a week means the design was not settled; stop tagging until it is.

## Pinning

The marketplace entry installs `main`, and `claude plugin install` has no version option. To stay on one version, clone the repo, check out the tag (`git checkout vX.Y.Z`) and install from that path with `claude plugin install <path>`; `claude plugin update` then changes nothing until you move the checkout. A pinned version is safe to keep until the next major's CHANGELOG lists something you use.

## History note

This policy starts at v3.23.0 (2026-10-23). Before it, releases were cut per fix: 96 tags in all, 44 in the 90 days before that date, up to eleven on one day, v2.0.0 and v3.0.0 one day apart, and three commands removed in a minor (3.14.0). The tag history up to v3.23.0 describes that habit, not this page; judge the cadence from the tags after it. The latest removal that skipped "Removing things" was in v3.14.0: `/agt-routing`, `/agt-ledger` and `/agt-squads` went away in a minor with no deprecating release before it (replacement: `/agt-info routing|ledger|squads`); the rules on this page cover what ships from v3.23.0 on. The first test is the fixes merged after v3.23.0 on the same day: they sit under `## [Unreleased]` in the CHANGELOG with no tag.
