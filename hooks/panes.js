// Pane transport: which multiplexer this session runs in (Herdr, tmux, or none), how to
// open a worker pane in it, and how to read tmux panes back as live.js pane agents.
// Pure helpers plus a few functions that take `$`; register.js only wires them.

export const SAFE_RUN = /^[A-Za-z0-9_-]{1,64}$/
export const NAME_RE = /^[a-z][a-z0-9_-]{0,31}$/
const ROLE_RE = /^[a-z0-9-]+$/
const MODEL_RE = /^(haiku|sonnet|opus|fable|claude-[a-z0-9.-]+)$/
const PROBE = { timeoutMs: 5000 }
const TAB = '\t'

export const SPAWN_ROLE = 'spawn'
export const DEFAULT_MODEL = 'sonnet'
export const SPAWN_USAGE = 'Usage: /agt-spawn "task" [--model sonnet|opus|haiku|fable]'

async function probe($, argv) {
  try {
    return (await $.process.run(argv, PROBE)).exitCode === 0
  } catch {
    return false
  }
}

// herdr when HERDR_ENV=1 and `herdr --version` runs; else tmux when $TMUX is set and
// `tmux -V` runs; else none. No $.process (desktop app, VS Code) is none.
export async function detectTransport($) {
  if (!$?.process?.run) return 'none'
  if ((await $.env.get('HERDR_ENV')) === '1' && (await probe($, ['herdr', '--version']))) return 'herdr'
  if (((await $.env.get('TMUX')) ?? '') !== '' && (await probe($, ['tmux', '-V']))) return 'tmux'
  return 'none'
}

// The line appended to the /agt skill prompt so the model knows which transport is live.
export function transportBlock(transport) {
  const line = {
    herdr: 'Parallel slices run as Herdr panes — see `panes-mode.md` → "Spawning a worker".',
    tmux: 'Parallel slices run as tmux panes — see `panes-mode.md` → "tmux transport".',
  }[transport] ?? 'No pane transport here: parallel slices run as a workflow, else subagent waves.'
  return '\n## Pane transport (agentille mod)\n\ntransport: ' + transport + '\n' + line + '\n'
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

// `"task" --model haiku` → { task, model }. `--model` may sit anywhere; surrounding
// quotes on the task are stripped. { usage } for a missing task, { error } for a bad model.
export function parseSpawnArgs(args) {
  let model = DEFAULT_MODEL
  let bad = null
  const rest = String(args ?? '').replace(/(^|\s)--model(?:\s+|=)(\S+)(\s|$)/, (_, lead, m, trail) => {
    if (MODEL_RE.test(m)) model = m
    else bad = m
    return lead && trail ? ' ' : ''
  }).trim()
  if (bad) return { error: 'Unknown model "' + bad + '". ' + SPAWN_USAGE }
  const task = rest.replace(/^(["'])([\s\S]*)\1$/, '$2').trim()
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

// tmux rows → live.js pane agents. `done` maps pane name → whether its done-file exists.
// Self is excluded, and so is every pane outside the lead's own window. A pane is done
// when its done-file exists or tmux says it is dead; seq is synthesized for reapable().
export function tmuxPaneAgents(rows, selfPane, done) {
  const me = rows.find((r) => r.id === selfPane)
  return rows
    .filter((r) => r.agt.startsWith('agt-') && r.id !== selfPane && (!me || r.window === me.window))
    .map((r) => {
      const n = splitName(r.agt)
      const finished = r.dead || done.get(r.agt) === true
      return { id: r.id, kind: 'pane', name: r.agt, role: n?.role ?? r.agt, run: n?.run ?? '', vendor: r.vendor || 'claude', state: finished ? 'done' : 'working', seq: finished ? 1 : 0, tab: r.window, workspace: null }
    })
}

// Only a pane with no @agt name of its own is a lead; workers never reap.
export function isLead(rows, selfPane) {
  const me = rows.find((r) => r.id === selfPane)
  return !!me && !me.agt.startsWith('agt-')
}

export async function listTmux($) {
  const r = await $.process.run(['tmux', 'list-panes', '-a', '-F', TMUX_LIST_FORMAT], PROBE)
  if (r.exitCode !== 0) throw new Error('tmux list-panes exited ' + r.exitCode)
  return parseTmuxList(r.stdout)
}

export async function readDone($, home, rows) {
  const done = new Map()
  for (const r of rows) {
    const n = r.agt.startsWith('agt-') ? splitName(r.agt) : null
    const file = n && doneFile(home, n.run, n.role)
    if (!file) continue
    try {
      done.set(r.agt, await $.fs.exists(file))
    } catch {
      // unreadable counts as not done
    }
  }
  return done
}

// ── reaping ───────────────────────────────────────────────────────────────────

// /agt-spawn panes belong to the person, not to a run: never offered to the reaper.
export function reapPool(panes) {
  return panes.filter((p) => p.role !== SPAWN_ROLE)
}

// ── spawning ──────────────────────────────────────────────────────────────────

export function tmuxSplitArgv({ target, cwd, run, shell, model, name, task }) {
  const head = ['tmux', 'split-window', '-d', '-h', '-P', '-F', '#{pane_id}', '-t', target, '-c', cwd, '-e', 'AGENTILLE_RUN=' + run]
  const tail = ['--model', model, '-n', name, task]
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

async function ok($, argv, init) {
  const r = await $.process.run(argv, init)
  if (r.exitCode !== 0) throw new Error(argv.slice(0, 3).join(' ') + ' exited ' + r.exitCode + (r.stderr ? ': ' + String(r.stderr).trim().slice(0, 200) : ''))
  return r
}

async function spawnTmux($, o) {
  const target = await $.env.get('TMUX_PANE')
  if (!target) throw new Error('TMUX_PANE is not set')
  const shell = (await $.env.get('SHELL')) ?? ''
  const r = await ok($, tmuxSplitArgv({ ...o, target, shell }), PROBE)
  const id = r.stdout.trim()
  if (!/^%\d+$/.test(id)) throw new Error('tmux gave no pane id')
  try {
    for (const argv of tmuxTagArgvs(id, o.name)) await ok($, argv, PROBE)
  } catch (err) {
    await $.process.run(['tmux', 'kill-pane', '-t', id], PROBE).catch(() => {})
    throw err
  }
  return id
}

async function spawnHerdr($, o) {
  const self = await $.env.get('HERDR_PANE_ID')
  if (!self) throw new Error('HERDR_PANE_ID is not set')
  const split = await ok($, ['herdr', 'pane', 'split', '--pane', self, '--direction', 'right', '--cwd', o.cwd, '--env', 'AGENTILLE_RUN=' + o.run, '--no-focus'], PROBE)
  const id = JSON.parse(split.stdout).result?.pane?.pane_id
  if (!id) throw new Error('herdr gave no pane id')
  try {
    await ok($, ['herdr', 'agent', 'start', o.name, '--kind', 'claude', '--pane', id, '--timeout', '45000', '--', '--model', o.model], { timeoutMs: 60000 })
    await ok($, ['herdr', 'agent', 'prompt', o.name, o.task], PROBE)
  } catch (err) {
    await $.process.run(['herdr', 'pane', 'close', id], PROBE).catch(() => {})
    throw err
  }
  return id
}

// Opens one claude pane beside this one, named agt-<run>-<role>, never focused.
// Resolves the pane id; rejects with a short reason, having closed a half-made pane.
export async function spawnPane($, transport, { run, role, model, task, cwd }) {
  const name = paneName(run, role)
  if (!name) throw new Error('bad pane name')
  const o = { run, model, task, cwd, name }
  if (transport === 'herdr') return spawnHerdr($, o)
  if (transport === 'tmux') return spawnTmux($, o)
  throw new Error('no pane transport')
}
