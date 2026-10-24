# Testing

agentille is checked in three layers. Each catches a different kind of break, and only the last one costs money.

| Layer | Command | Catches | Where it runs |
|---|---|---|---|
| Structural | `bash scripts/validate.sh` | version drift, broken agent references, role and routing-table drift, dangling doc cross-refs, a mod module that fails to import, a workflow file that does not parse, PII in tracked files, and the shell tests under `tests/hooks/` | every PR and push to `main` (`validate.yml`, ubuntu and macOS), the `pre-push` hook, each release tag |
| Mod | `claude plugin test .` | the hook mod's behaviour: stores, guards (denials and allow paths), routing table, pane tools, display, and a deterministic replay of the eval cases' routing expectations | inside the structural run when the `claude` CLI is installed (CI installs a pinned version), so on every PR |
| Behavioral | `claude plugin eval .` | `/agt`'s dispatch decisions on real prompts: the level and transport on the recon line, the roster, each role's model and effort, the formation | weekly and on each release tag (`evals.yml`), and by hand |

The first two need no credential, so CI on pull requests stays credential-free: a PR from a fork runs exactly what a PR from the repo runs.

## The routing replay

`tests/mod/routing-replay.test.ts` replays the eval cases in `evals/` against the mod's own routing, with no model call. For each case it writes the dispatch header the lead would send (the size, risk, mode, formation and slice the case implies, under the documented defaults: no profile, `autoFable` off, no `thinkingDepth`) and asserts what the mod does with it: `parseHeader` reads it, `decide()` routes each role to the model and effort the case expects, `formationOf` reads the formation, and the executor cap lets the case's slices run at once. Each test is named `<case>/<grader>` after the grader it replays.

It covers the graders that have a code half: 5 of the 15 (auth-gauntlet: `header-risk-auth`, `security-reviewer-opus-max`, `formation-gauntlet`; parallel-slices: `two-parallel-slices`, its routing and cap half; review-reviewers: `code-reviewer-sonnet-medium`). The other 10 are decisions the lead makes from skill text, which no exported function makes: the level and transport on the recon line (every `recon-*` grader), which roles the roster holds (`roster-has-*`, `roster-no-executor`, `roster-none`), and all of solo-one-liner, which dispatches nothing to route. Those stay with the eval. A change to `hooks/routing.js` that moves a recorded expectation fails here, on the PR, before the next eval run.

## The eval workflow

`.github/workflows/evals.yml` runs the eval suite in `evals/` (four cases, each a `/agt` prompt with regex checks on its final answer). It runs:

- every Monday at 06:17 UTC,
- on every `vX.Y.Z` tag push,
- by hand from the Actions tab (Run workflow), with an optional `runs` input: 1, 2 or 3 runs per case, default 1.

The command, with every `HERDR_*` and `TMUX*` variable removed from its environment:

```bash
AGENTILLE_RAW_URL=file:///dev/null claude plugin eval . --runs "$RUNS" --ablation none \
  --no-publish --trust-plugin --max-cost-usd 2 --threshold 0.66
```

- `--max-cost-usd 2` is the hard ceiling. The CLI checks it before each run starts and stops once it is reached; runs go one at a time, so at most one run in flight can go past it. One run per case costs well under that (4 cases × 3 runs measured $1.81 at v3.8.0). The job also stops after 30 minutes, and each case has its own `max_turns` and `timeout_seconds`.
- `--no-publish` keeps the HTML report local. The workflow token is read-only, so the job cannot push, tag or comment either.
- `--trust-plugin` answers the first-run trust prompt (see below).
- `--ablation none`: a run without the plugin has no `/agt` to measure.
- `AGENTILLE_RAW_URL=file:///dev/null` keeps the mod's update check off the network.

### The secret

The repo owner adds one repository secret, `ANTHROPIC_API_KEY` (Settings → Secrets and variables → Actions). Without it, what the job does depends on what started it:

- a `vX.Y.Z` tag push fails with `::error::no ANTHROPIC_API_KEY secret: release tag … has no eval signal`. A tag is a release, and a release without its eval result should be red, not quietly green;
- the weekly schedule fails the same way: it is the repo's own standing signal, and a green week with no eval would mean nothing;
- a run by hand prints `evals skipped: no ANTHROPIC_API_KEY secret` and passes, so a fork can run the workflow without the secret.

The event decides, not the ref: a run by hand started on a tag still skips. Every eval run is billed to that key.

### Reading the result

Each run uploads an `evals-results` artifact, kept for 30 days. Inside it:

- `console.log`: the CLI's own output; its last 40 lines are also on the run's summary page.
- `<timestamp>/report.html`: the readable report, per case: the prompt, each run's final answer and which checks matched. Download the artifact and open it in a browser.
- `<timestamp>/aggregate-result.json`: the same data as JSON, per case and per run.

The artifact holds model transcripts and paths on the runner, nothing from your machine. On a public repo anyone signed in to GitHub can download it.

### What a red run means

| Exit | Meaning | What to do |
|---|---|---|
| 0 | every case passed at least 66% of its weighted checks | nothing |
| 1 | a case fell under 66%, or the run itself failed | open `report.html`, find the case, and compare its recon, roster and header lines with `skills/agt/routing.md`. A real drift means a change to `skills/agt/` or `hooks/routing.js` moved a decision; one bad run out of one can be noise, so rerun by hand with `runs: 3` before acting |
| 2 | the $2 ceiling stopped the run, results are partial | the prompts or the model got more expensive: check the cost in the report before raising the cap |

A failing eval run blocks nothing: it is a signal for the next release, not a merge gate.

### Trust without a terminal

`claude plugin eval` asks once whether to trust a plugin folder before it loads it. With no terminal (CI, or `--json`) it cannot ask, and it refuses with `is not a trusted plugin directory`. It treats a folder as trusted when one of these holds:

1. the target is an installed plugin;
2. the folder, or a parent, has `"hasTrustDialogAccepted": true` under `projects` in `~/.claude.json` (what answering the prompt once in a terminal writes);
3. `--trust-plugin` is passed.

The workflow uses `--trust-plugin`: the checkout is this repo's own code, and `--scaffold`, `--allow-tools` and real MCP servers stay off. Writing option 2 into the runner's `~/.claude.json` would work too, but the flag says the same thing in the command where it can be read.

## Running the evals locally

From a shell outside Herdr and tmux (or with their variables unset), on your own credential:

```bash
AGENTILLE_RAW_URL=file:///dev/null claude plugin eval . --runs 3 --ablation none --no-publish --max-cost-usd 5 --threshold 0.66
```

Run it before releasing a change to `skills/agt/` or `hooks/routing.js`. The first run in a terminal asks to trust the folder once. Results land in `evals/results/`, which is gitignored because transcripts hold absolute paths.
