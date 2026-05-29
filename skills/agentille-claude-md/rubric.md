# CLAUDE.md tune-up rubric

The canonical checklist `agentille-claude-md` applies. A line **stays** only if it survives all of points 1–6; point 7 is an absolute exception that overrides 1–2.

1. **Cut lines that don't change behavior.** If removing the line would not change how Claude acts, remove it.
2. **Cut what Claude can infer from the repo.** Framework, language, file layout, and tooling that are obvious from the codebase don't belong in CLAUDE.md.
3. **Imperative bullets, not prose.** "Use X." not "I would prefer that you try to use X where possible."
4. **Group under clear headers.** Related rules live together under a short `##` header.
5. **No duplication.** Say each rule once.
6. **No vague platitudes.** "Be helpful", "write good code", "be careful" — cut. They change nothing.
7. **Preserve identity/personal context.** The user's name, role, stack ownership, and genuine project constraints stay verbatim. This is a personal local file — trimming targets bloat, never the person. NEVER anonymize or strip identity.

## Cut-list reason tags

When proposing a rewrite, tag every removed or merged line with one of:

- `vague` — failed point 6 (platitude, no behavioral effect).
- `inferable` — failed point 2 (derivable from the repo).
- `duplicate` — failed point 5 (already stated elsewhere).
- `default-restated` — restates Claude's default behavior; failed point 1.
