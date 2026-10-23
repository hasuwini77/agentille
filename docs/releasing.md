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

To stay on one version: `claude plugin install agentille@hasuwini77-agentille --version x.y.z` (or check out the tag). A pinned version is safe to keep until the next major's CHANGELOG lists something you use.

## History note

Before v3.23.0 (2026-10-23) releases were cut per fix: 43 tags in the previous 90 days, v2.0.0 and v3.0.0 one day apart, and commands removed in a minor (3.14.0). This page is the correction; a reviewer counting tags after that date should see the cadence above.
