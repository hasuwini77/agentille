# CLAUDE.md tune-up rubric

A line **stays** only if it survives points 1–6 and 8; point 7 is an absolute exception that overrides 1–2.

1. **Cut lines that don't change behavior.** If removing the line would not change how Claude acts, remove it.
2. **Cut what Claude can infer from the repo.** Framework, language, layout and tooling obvious from the codebase don't belong here.
3. **Imperative bullets, not prose.** "Use X." not "I would prefer that you try to use X where possible."
4. **Group under clear headers.** Related rules live together under a short `##` header.
5. **No duplication.** Say each rule once.
6. **No vague platitudes.** "Be helpful", "write good code", "be careful" — cut.
7. **Preserve identity/personal context.** Name, role, stack ownership and genuine project constraints stay verbatim. Trimming targets bloat, never the person.
8. **A rule that mandates ceremony must say when it does not apply.** "Always open an issue first" needs "except trivial or docs changes"; otherwise add the exemption or cut it.

## Cut-list reason tags

- `vague` — failed point 6.
- `inferable` — failed point 2.
- `duplicate` — failed point 5.
- `default-restated` — restates Claude's default behavior; failed point 1.
- `enforced-elsewhere` — already enforced by a hook, linter, CI or the tool itself; cut it.
