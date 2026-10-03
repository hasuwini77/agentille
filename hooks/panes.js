// Pane transport: which multiplexer this session runs in (Herdr, tmux, or none), how to
// open a worker pane in it, and how to read tmux panes back as live.js pane agents.
// Pure on purpose — the hooks loader never follows `$` across an import — so every
// $.process / $.env / $.fs call lives in register.js and only feeds these helpers.

import { isAgtPrompt } from './live.js'

export const SAFE_RUN = /^[A-Za-z0-9_-]{1,64}$/
export const NAME_RE = /^[a-z][a-z0-9_-]{0,31}$/
const ROLE_RE = /^[a-z0-9-]+$/
const MODEL_LIKE = /^[A-Za-z0-9][\w.-]*$/
const BARE_WORD = /^[a-z-]+$/
const MODEL_RE = /^(haiku|sonnet|opus|fable|claude-[a-z0-9.-]+)$/
export const PROBE = { timeoutMs: 5000 }
export const HERDR_START_TIMEOUT = { timeoutMs: 60000 }
const TAB = '\t'

export const SPAWN_ROLE = 'spawn'
export const DEFAULT_MODEL = 'sonnet'
export const SPAWN_USAGE = 'Usage: /agt-spawn "task" [--model sonnet|opus|haiku|fable]'

// herdr when HERDR_ENV=1 and `herdr --version` ran; else tmux when $TMUX is set and
// `tmux -V` ran; else none. Callers pass what their probes found (a probe that rejects
// or exits non-zero is false).
export function pickTransport({ herdrOk, tmuxOk }) {
  return herdrOk ? 'herdr' : tmuxOk ? 'tmux' : 'none'
}

// The line appended to the /agt skill prompt so the model knows which transport is live.
export function transportBlock(transport) {
  const line = {
    herdr: 'Parallel slices run as Herdr panes — see `panes-mode.md` → "Spawning a worker".',
    tmux: 'Parallel slices run as tmux panes — see `panes-mode.md` → "tmux transport".',
  }[transport] ?? 'No pane transport here: parallel slices run as a workflow, else subagent waves.'
  return '\n## Pane transport (agentille mod)\n\ntransport: ' + transport + '\n' + line + '\n'
}

// A typed /agt that forces a team: `--team <name>` → { template: name }, `--mode team`
// → { template: null }; anything else → null. --team wins when both appear.
export function teamForce(text) {
  if (!isAgtPrompt(text)) return null
  const t = String(text)
  const named = /(?:^|\s)--team(?:=|\s+)([A-Za-z0-9_-]+)/.exec(t)
  if (named) return { template: named[1] }
  return /(?:^|\s)--mode(?:=|\s+)team(?=\s|$)/.test(t) ? { template: null } : null
}

// The toast shown when a team is forced: names where the run will actually land.
export function teamNotice(transport) {
  const where = { herdr: 'panes · herdr', tmux: 'panes · tmux' }[transport] ?? 'a team — no pane transport here'
  return '--team is deprecated (removed in v3.0): running as ' + where + '.'
}

// Appended after the transport block when a team was forced: resolve it as panes (or
// subagent) when a transport exists, else run the team as before and say so.
export function teamDirective(transport) {
  const line = transport === 'herdr' || transport === 'tmux'
    ? 'A forced team (--team/--mode team) is deprecated: resolve it as panes when the task has ≥2 genuinely disjoint slices, else subagent (the existing honesty flow). Do not spawn an agent team.'
    : 'A forced team is deprecated (removed in v3.0); no pane transport here, so run the team as before and print the deprecation line on the recon ping.'
  return '\n## Forced team (agentille mod)\n\n' + line + '\n'
}

// ── names ─────────────────────────────────────────────────────────────────────

export function paneName(run, role) {
  const name = 'agt-' + run + '-' + role
  return SAFE_RUN.test(run) && ROLE_RE.test(role) && NAME_RE.test(name) ? name : null
}

export function newRunId() {
  let id = ''
  while (id.length < 6) id += Math.floor(Math.random() * 36).toString(36)
  return id
}

// `agt-<run>-<role…>` → { run, role } with both safe to put in a path, else null.
export function splitName(name) {
  const parts = String(name ?? '').split('-')
  if (parts[0] !== 'agt' || parts.length < 3) return null
  const run = parts[1]
  const role = parts.slice(2).join('-')
  return SAFE_RUN.test(run) && ROLE_RE.test(role) ? { run, role } : null
}

export function doneFile(home, run, role) {
  if (!home || !SAFE_RUN.test(run) || !ROLE_RE.test(role)) return null
  return home + '/.agentille/state/run-' + run + '/done-' + role
}

// ── /agt-spawn arguments ──────────────────────────────────────────────────────

// `"task" --model haiku` → { task, model }. `--model` counts as the flag only when it stands
// alone before a model-looking token; "explain the --model flag" stays prose. One matching pair of
// surrounding quotes is stripped. { usage } for a missing task, { error } for a bad model or a
// single bare word (claude would run it as a subcommand).
export function parseSpawnArgs(args) {
  let model = DEFAULT_MODEL
  let bad = null
  let taken = false
  const rest = String(args ?? '').replace(/(^|\s)--model(?:\s+|=)(\S+)(?=\s|$)/g, (whole, _lead, m) => {
    if (taken) return whole
    if (MODEL_RE.test(m)) model = m
    else if (MODEL_LIKE.test(m) && /[^a-z]/.test(m)) bad = m
    else return whole
    taken = true
    return ''
  }).trim()
  if (bad) return { error: 'Unknown model "' + bad + '". ' + SPAWN_USAGE }
  const task = rest.replace(/^(["'])((?:(?!\1)[\s\S])*)\1$/, '$2').trim()
  if (BARE_WORD.test(task)) return { error: 'A one-word task would run as a claude subcommand. Say more. ' + SPAWN_USAGE }
  return task ? { task, model } : { usage: SPAWN_USAGE }
}

// ── tmux ──────────────────────────────────────────────────────────────────────

export const TMUX_LIST_FORMAT = ['#{pane_id}', '#{@agt}', '#{@agt_vendor}', '#{pane_dead}', '#{window_id}'].join(TAB)

export function parseTmuxList(stdout) {
  return String(stdout ?? '').split('\n').filter(Boolean).map((line) => {
    const [id, agt, vendor, dead, window] = line.split(TAB)
    return { id, agt: agt ?? '', vendor: vendor ?? '', dead: dead === '1', window: window ?? '' }
  }).filter((r) => r.id)
}

// The agt- panes a lead looks at: not itself, and only in its own window. Without a known
// self (its pane is missing from the list) nothing is window-scoped, so nothing is trusted.
export function scopeRows(rows, selfPane) {
  const me = rows.find((r) => r.id === selfPane)
  return rows.filter((r) => r.agt.startsWith('agt-') && r.id !== selfPane && (!me || r.window === me.window))
}

// A done-file counts only if it was written once the pane was already known: a file left by
// an earlier worker of the same role must not mark the new one done.
export function isFreshDone(stat, since) {
  return stat?.kind === 'file' && typeof stat.mtimeMs === 'number' && typeof since === 'number' && stat.mtimeMs >= since
}

// /agt-spawn panes are the person's, not a run's: shown as `open`, never as working or done,
// so they feed no spinner, busy timer or working count.
export function quietSpawn(panes) {
  return panes.map((p) => (p.role === SPAWN_ROLE ? { ...p, state: 'open', seq: 0 } : p))
}

// tmux rows → live.js pane agents. `done` maps pane name → whether a fresh done-file exists.
// A pane is done when that holds or tmux says it is dead; seq is synthesized for reapable().
export function tmuxPaneAgents(rows, selfPane, done) {
  return quietSpawn(scopeRows(rows, selfPane).map((r) => {
    const n = splitName(r.agt)
    const finished = r.dead || done.get(r.agt) === true
    return { id: r.id, kind: 'pane', name: r.agt, role: n?.role ?? r.agt, run: n?.run ?? '', vendor: r.vendor || 'claude', state: finished ? 'done' : 'working', seq: finished ? 1 : 0, tab: r.window, workspace: null }
  }))
}

// Only a pane with no @agt name of its own is a lead; workers never reap.
export function isLead(rows, selfPane) {
  const me = rows.find((r) => r.id === selfPane)
  return !!me && !me.agt.startsWith('agt-')
}

export const TMUX_LIST_ARGV = ['tmux', 'list-panes', '-a', '-F', TMUX_LIST_FORMAT]

// ── reaping ───────────────────────────────────────────────────────────────────

// /agt-spawn panes belong to the person, not to a run: never offered to the reaper.
export function reapPool(panes) {
  return panes.filter((p) => p.role !== SPAWN_ROLE)
}

// ── spawning ──────────────────────────────────────────────────────────────────

export function tmuxSplitArgv({ target, cwd, run, shell, model, name, task }) {
  const head = ['tmux', 'split-window', '-d', '-h', '-P', '-F', '#{pane_id}', '-t', target, '-c', cwd.replace(/#/g, '##'), '-e', 'AGENTILLE_RUN=' + run]
  // `--` ends claude's options, so a task that starts with `-` is still just the prompt
  const tail = ['--model', model, '-n', name, '--', task]
  const base = String(shell ?? '').split('/').pop()
  if (base === 'zsh' || base === 'bash') return [...head, shell, '-ic', 'claude "$@"', 'agt', ...tail]
  return [...head, 'claude', ...tail]
}

export function tmuxTagArgvs(id, name) {
  return [
    ['tmux', 'set-option', '-p', '-t', id, '@agt', name],
    ['tmux', 'set-option', '-p', '-t', id, '@agt_vendor', 'claude'],
    ['tmux', 'set-option', '-p', '-t', id, 'allow-set-title', 'off'],
    ['tmux', 'select-pane', '-t', id, '-T', name],
  ]
}

export function tmuxPaneIdOf(stdout) {
  const id = String(stdout ?? '').trim()
  return /^%\d+$/.test(id) ? id : null
}

export const tmuxKillArgv = (id) => ['tmux', 'kill-pane', '-t', id]

// herdr: split beside the lead (never focused), start claude in it, then prompt it.
export function herdrSplitArgv({ pane, cwd, run }) {
  return ['herdr', 'pane', 'split', '--pane', pane, '--direction', 'right', '--cwd', cwd, '--env', 'AGENTILLE_RUN=' + run, '--no-focus']
}

export function herdrPaneIdOf(stdout) {
  try {
    return JSON.parse(stdout).result?.pane?.pane_id ?? null
  } catch {
    return null
  }
}

export const herdrStartArgv = ({ name, pane, model }) => ['herdr', 'agent', 'start', name, '--kind', 'claude', '--pane', pane, '--timeout', '45000', '--', '--model', model]
export const herdrPromptArgv = (name, task) => ['herdr', 'agent', 'prompt', name, task]
export const herdrCloseArgv = (id) => ['herdr', 'pane', 'close', id]
