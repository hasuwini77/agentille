---
name: agentille-claude-md
description: Tune a CLAUDE.md to be lean and high-signal. Applies a fixed "less is more" rubric and proposes a shorter rewrite with a per-line cut-list. Non-destructive: shows a diff, backs up the original, writes only on explicit approval. Defaults to ~/.claude/CLAUDE.md; pass a path for a project file. Use when the user says "tune / slim / improve my CLAUDE.md" or types /agentille-claude-md.
argument-hint: [path-to-CLAUDE.md]
---

# agentille-claude-md — CLAUDE.md tune-up

Opinionated trim, never a silent overwrite. Runs locally: reads one file, writes that file plus a `.bak`, sends nothing anywhere. Never auto-trigger.

## Steps

1. **Target.** No argument → `~/.claude/CLAUDE.md`; otherwise the given path. If the file does not exist, say "No CLAUDE.md at `<target>` — nothing to tune" and STOP; create nothing. Otherwise read it and count its lines.
2. **Rewrite in memory.** Apply `rubric.md` to produce a leaner REWRITE. Identity and personal context (rubric point 7) stay verbatim. Tag every removed or merged line with a reason tag from the rubric.
3. **Present:** the full REWRITE, the cut-list (one line per removed or merged original line with its tag), and `before <N> → after <M>`. Then ask: "Apply this rewrite to `<target>`? (yes / no)".
4. **On yes:** `cp <target> <target>.bak` (if the `.bak` exists, ask before overwriting it; on no, stop without writing), then write REWRITE to `<target>`. Print `Tuned <target> — N → M lines. Backup: <target>.bak`.
   **On no:** write nothing and print `No changes written.`

## Hard rules

- Never write without explicit approval; diff first.
- Always back up first; never overwrite a `.bak` unasked.
- Never create a file; if the target is absent, stop.
- Never anonymize or strip the user's name, role, stack or genuine constraints.

## Example (generic)

Before (4 lines): `I am a developer and would like you to be concise.` / `Use TypeScript for this Vite app.` / `Be helpful and write good clean code.` / `Use TypeScript.`

After (2 lines): `- Developer; be concise.` / `- TypeScript only; no any.`

Cut-list: "Vite app" → `inferable`; "Be helpful…" → `vague`; "Use TypeScript." → `duplicate`.
