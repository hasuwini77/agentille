---
name: agentille-claude-md
description: Tune up a CLAUDE.md to be lean and high-signal — reads the file, applies a fixed "less is more" rubric, and proposes a shorter rewrite with a per-line cut-list. Non-destructive: always shows a diff, backs up the original, and writes only on explicit approval. Defaults to the global ~/.claude/CLAUDE.md; pass a path to tune a project ./CLAUDE.md. Use when the user says "tune / slim / improve my CLAUDE.md" or types /agentille-claude-md.
argument-hint: [path-to-CLAUDE.md]
---

# agentille-claude-md — CLAUDE.md tune-up

Make a CLAUDE.md lean and high-signal. Opinionated trim, never a silent overwrite.

This skill runs entirely on the local machine. It reads one file and writes back to that same file (plus a local backup). It never transmits the file anywhere.

## When to invoke

- User types `/agentille-claude-md`, or says "tune / slim / improve / clean up my CLAUDE.md".
- `agentille-init` offers the handoff at the end of setup and the user says yes.

Do NOT auto-trigger.

## Target file

- No argument → `~/.claude/CLAUDE.md` (the user's global file).
- Argument given → that path (e.g. `./CLAUDE.md` for the current repo).

## What to do

### (a) Resolve and read the target

```bash
cat <target> 2>/dev/null
```

- If the file does not exist → tell the user *"No CLAUDE.md at `<target>` — nothing to tune. (This skill improves an existing file; it doesn't create one.)"* and **STOP**. Create nothing.
- If it exists → read it as ORIGINAL and count its lines.

### (b) Apply the rubric

Apply `rubric.md` (in this skill's directory) to ORIGINAL, producing a leaner REWRITE **in memory**. Do not write anything yet.

- Honor rubric point 7 absolutely: identity/personal context (name, role, stack ownership, genuine constraints) is preserved verbatim.
- Every removed or merged line gets a reason tag: `vague`, `inferable`, `duplicate`, or `default-restated`.

### (c) Present for approval

Show the user, in this order:

1. The full proposed REWRITE.
2. A **cut-list** — one line per removed/merged original line, each with its reason tag.
3. Line counts: `before <N> → after <M>`.

Then ask: *"Apply this rewrite to `<target>`? (yes / no)"*

### (d) On explicit "yes" — back up, then write

```bash
cp <target> <target>.bak
```

- If `<target>.bak` already exists, warn first: *"`<target>.bak` already exists — overwrite it? (yes/no)"* and only `cp` on yes. If no, stop without writing.
- Then write REWRITE to `<target>` (trailing newline, no trailing whitespace).

On "no" → write nothing, change nothing.

### (e) Confirm

Print:
- *"Tuned `<target>` — <N> → <M> lines."*
- *"Backup saved to `<target>.bak`."*
- (or, on decline) *"No changes written."*

## Hard rules

- **Never write without explicit approval.** Diff first, write only on "yes".
- **Always back up** the original before writing. Never overwrite a `.bak` without asking.
- **Never create a file.** If the target is absent, stop.
- **Preserve identity.** Never anonymize or strip the user's name, role, stack, or genuine constraints (rubric point 7).
- **Local only.** Never send the file's contents anywhere.

## Example (generic — illustrative only)

Before (`~/.claude/CLAUDE.md`, 6 lines):

```markdown
# About me
I am a developer and I would really like it if you could try to be concise.
Please use TypeScript for this project which is a Vite app.
Be helpful and write good clean code.
Use TypeScript.
```

Proposed rewrite (3 lines):

```markdown
# About me
- Be concise.
- TypeScript only; no `any`.
```

Cut-list:
- "I am a developer …" → kept as identity, reworded to imperative.
- "Please use TypeScript … Vite app" → `inferable` (stack is obvious from the repo).
- "Be helpful and write good clean code." → `vague`.
- "Use TypeScript." → `duplicate`.

`before 6 → after 3`
