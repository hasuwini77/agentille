# Formations — run shapes beyond the plain roster

A formation changes how workers relate, not where they run. One per run at most, never on `thinkingDepth=quick`. Every dispatch header carries `formation=<name>` (`SKILL.md` → "Dispatch header"). Formation results fold into the final card's `review:` line (`display.md` → "Final card"). A forced formation that does not fit gets one honest line and runs without it.

## gauntlet — build, attack, fix

Automatic on feature and bugfix work with `risk` auth/money/data and a test runner in the repo (without one, use the normal review gate and say why). The adversary runs between the executor and the reviewers:

1. Executor builds with `integration: local` (nothing pushed until the gauntlet clears).
2. `agentille:agentille-adversary` writes 3–8 tests meant to break the diff and reports `BROKEN: n · HELD: n`.
3. `BROKEN: 0` → reviewers. Otherwise the broken cases go back to the executor (`mode=fix`, tests not weakened), then one more adversary round with new cases only.
4. Still broken after round 2: stop and put the cases on the card's `⚑`. The tests stay as regression tests.

## duel — best of two

Only on request (`--formation duel`, or "try two approaches"). Needs machine-checkable done-criteria. The planner writes two briefs that differ in strategy; two executors build in separate worktrees with `integration: local`; tests judge first, then one `code-reviewer` answers `WINNER: A|B` and `WHY`. The loser's branch is deleted, never pushed.

## relay — contract first, then parallel

Only on request (`--formation relay`, or "contract-first split"), for ≥2 slices coupled by one interface. Leg 1: one executor commits types, stubs and contract tests. Leg 2: the slices build in parallel from that commit; the contract is frozen, and a slice that needs it changed stops and reports `CONTRACT: <what and why>`.

## Honest cost

A gauntlet costs about 1.3–1.6× build tokens, a duel about 2×, a relay about +15%. Say so in the recon line's reason, and never claim a saving the ledger does not show.
