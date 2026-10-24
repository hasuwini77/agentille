# Contributing to agentille

The full contributor guide (repo layout, conventions, release recipe, privacy rules) is [.claude/CLAUDE.md](./.claude/CLAUDE.md). Read it first; it is also what an AI agent working here loads.

Three verification layers, before you open a PR:

- **Structural:** `bash scripts/validate.sh`. The `pre-push` hook and CI run it too.
- **Mod:** `claude plugin test .` runs the tests in `tests/mod/`.
- **Behavioral:** the eval suite in `evals/` (`claude plugin eval .`, exact flags in `.claude/CLAUDE.md` → Conventions). Local and manual only, never in CI: each run spends your own credential.

Everything reaches `main` through a pull request; never push to `main` directly. Cadence and what each version promises: [docs/releasing.md](./docs/releasing.md).
