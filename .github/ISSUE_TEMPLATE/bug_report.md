---
name: Bug report
about: Something agentille did differs from what the docs say it does
title: "bug: "
labels: bug
---

## Versions

- Claude Code (`claude --version`):
- agentille (the `version` in the plugin's `.claude-plugin/plugin.json`, or the `v<version>` the band header shows):
- OS and pane transport (Herdr, tmux and its version, or none):

## What you typed

The exact line, `/agt` and its flags included. Replace anything private with a placeholder.

```
/agt "..."
```

## What you expected

## What happened

Paste what the card, the recon line or the band showed. A screenshot of the band is fine. If a run dir was written, the relevant lines of `report.md` help most. Leave out paths, names and repo details you would not post in public.

```
recon: ...
```

## Verification you ran

Tick what you ran on a clone of this repo, with the counts it printed. None of these is required to file a bug, but each one narrows it down.

- [ ] Structural: `bash scripts/validate.sh` → _ fail(s), _ warning(s)
- [ ] Mod: `claude plugin test .` → _ pass, _ fail
- [ ] Behavioral: the eval suite in `evals/` (flags in `.claude/CLAUDE.md` → Conventions) → score _

## Anything else

Steps to reproduce from a fresh session, if you have them.
