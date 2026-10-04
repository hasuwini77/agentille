// Pane transport: which multiplexer this session runs in (Herdr, tmux, or none), how to
// open a worker pane in it, and how to read tmux panes back as live.js pane agents.
// Pure on purpose — the hooks loader never follows `$` across an import — so every
// $.process / $.env / $.fs call lives in register.js and only feeds these helpers.

import { ROLES, parseHeader } from './routing.js'

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

export const PANE_RULE = 'Pane rule: every executor slice (even a single one), the adversary, and any reviewer routed to opus or fable run as pane workers; planner, plan-reviewer, ui-prototyper, sonnet-routed reviewers and seo-reviewer stay subagents. Call spawn_pane with agent (the routing role) and header (this run\'s full [agt …] line): the mod picks model and effort, and refuses roles that stay subagents. A pane starts as a full Claude session (~55k tokens vs ~32k for a subagent; measured 1.12× the fresh tokens of the same workers as subagents): it buys a visible worker, not a saving. `--mode subagent` keeps every worker a subagent.'

// The line appended to the /agt skill prompt so the model knows which transport is live,
// and, when the mod registered them, that the pane tools replace the manual recipe.
export function transportBlock(transport, tools = false) {
  const line = {
    herdr: 'Parallel slices run as Herdr panes — see `panes-mode.md` → "Spawning a worker".',
    tmux: 'Parallel slices run as tmux panes — see `panes-mode.md` → "tmux transport".',
  }[transport] ?? 'No pane transport here: parallel slices run as a workflow, else subagent waves.'
  const viaTools = tools && transport !== 'none'
    ? 'Open each claude worker with mcp__agentille__spawn_pane and close it after harvest with mcp__agentille__close_pane — see `panes-mode.md` → "Through the mod\'s tools".\n' + PANE_RULE + '\n'
    : ''
  return '\n## Pane transport (agentille mod)\n\ntransport: ' + transport + '\n' + line + '\n' + viaTools
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

export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max']
const effortArgs = (effort) => (EFFORTS.includes(effort) ? ['--effort', effort] : [])
// A routed worker runs as its agentille agent definition (instructions, tools, verdict format),
// not as a bare session that only has the task prompt.
const agentArgs = (agent) => (ROLES.includes(agent) ? ['--agent', 'agentille:agentille-' + agent] : [])

// Who the worker is, for its own mascot band: <agent>:<model>:<effort>. A typed /agt-spawn has no agent.
export const workerEnv = ({ agent, model, effort }) => 'AGENTILLE_WORKER=' + [agent || SPAWN_ROLE, model, EFFORTS.includes(effort) ? effort : ''].join(':')

export function tmuxSplitArgv({ target, cwd, run, shell, model, name, task, effort, direction, agent }) {
  const head = ['tmux', 'split-window', '-d', direction === 'down' ? '-v' : '-h', '-P', '-F', '#{pane_id}', '-t', target, '-c', cwd.replace(/#/g, '##'), '-e', 'AGENTILLE_RUN=' + run, '-e', workerEnv({ agent, model, effort })]
  // `--` ends claude's options, so a task that starts with `-` is still just the prompt
  const tail = [...agentArgs(agent), '--model', model, ...effortArgs(effort), '-n', name, '--', task]
  const base = String(shell ?? '').split('/').pop()
  if (base === 'zsh' || base === 'bash') return [...head, shell, '-ic', 'claude "$@"', 'agt', ...tail]
  return [...head, 'claude', ...tail]
}

// Stacked layout: the first worker splits right of the lead, each later one splits down from the
// newest worker still live. No width probing: a stack always has room for one more row.
export function splitPlan({ lead, opened = [], live = [] }) {
  const alive = opened.filter((o) => live.some((p) => p.id === o.id))
  return alive.length ? { target: alive[alive.length - 1].id, direction: 'down' } : { target: lead, direction: 'right' }
}

export const tmuxEvenArgv = (id) => ['tmux', 'select-layout', '-E', '-t', id]

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
export function herdrSplitArgv({ pane, cwd, run, direction, agent, model, effort }) {
  return ['herdr', 'pane', 'split', '--pane', pane, '--direction', direction === 'down' ? 'down' : 'right', '--cwd', cwd, '--env', 'AGENTILLE_RUN=' + run, '--env', workerEnv({ agent, model, effort }), '--no-focus']
}

export function herdrPaneIdOf(stdout) {
  try {
    return JSON.parse(stdout).result?.pane?.pane_id ?? null
  } catch {
    return null
  }
}

export const herdrStartArgv = ({ name, pane, model, effort, agent }) => ['herdr', 'agent', 'start', name, '--kind', 'claude', '--pane', pane, '--timeout', '45000', '--', ...agentArgs(agent), '--model', model, ...effortArgs(effort)]
export const herdrPromptArgv = (name, task) => ['herdr', 'agent', 'prompt', name, task]
export const herdrCloseArgv = (id) => ['herdr', 'pane', 'close', id]

const REVIEWERS = new Set(['code-reviewer', 'security-reviewer', 'design-reviewer', 'payments-reviewer', 'perf-reviewer'])
const SUBAGENT_ONLY = new Set(['planner', 'plan-reviewer', 'ui-prototyper'])

// Whether a routing role runs as a pane worker, given the routing decision for it.
export function paneRole(agent, decision) {
  const m = String(decision?.model ?? '')
  if (agent === 'executor' || agent === 'adversary') return { pane: true, why: '' }
  if (REVIEWERS.has(agent)) {
    return /opus|fable/.test(m)
      ? { pane: true, why: '' }
      : { pane: false, why: `${agent} is routed to ${m || 'an unknown model'}: run it as a subagent; only opus or fable reviewers get a pane.` }
  }
  if (agent === 'seo-reviewer') return { pane: false, why: 'seo-reviewer stays a subagent: a short read-only pass does not pay back a pane\'s start-up.' }
  if (SUBAGENT_ONLY.has(agent)) return { pane: false, why: `${agent} stays a subagent: its full answer feeds the next dispatch.` }
  return { pane: false, why: `${agent} is not a routing role.` }
}

// ── pane tools: /agt panes mode opens and closes workers through the mod ──────

// Fable is not offered: on a tool it would skip the routing guard. A typed /agt-spawn may still pick it.
export const TOOL_MODELS = ['sonnet', 'opus', 'haiku']

export const SPAWN_TOOL = {
  name: 'spawn_pane',
  description: 'Open one agentille worker pane beside this session (Herdr or tmux, whichever is live), never focused, named agt-<run>-<role>, running Claude on the model and effort agentille routes for `agent`, with the task as its first prompt. Use it for each panes-mode slice in place of raw herdr/tmux commands. The pane is reaped once it sits done; close it yourself with close_pane after harvesting.',
  inputSchema: {
    type: 'object',
    properties: {
      run: { type: 'string', description: 'The run id from the [agt run=…] header (6 chars).' },
      role: { type: 'string', description: 'Slice role, lowercase letters, digits and dashes (exec-1, review). Not "spawn".' },
      task: { type: 'string', description: 'The full self-contained worker prompt.' },
      agent: { type: 'string', enum: ROLES, description: 'Routing role (executor, code-reviewer, …): the mod routes model and effort from it.' },
      header: { type: 'string', description: 'This run\'s full [agt run=… size=… risk=… mode=… fable=…] line.' },
      model: { type: 'string', enum: TOOL_MODELS, description: 'Ignored: the mod routes model and effort from agent + header. Kept so older prompts validate.' },
      cwd: { type: 'string', description: 'Absolute directory to start in (the slice worktree). Default: this session\'s directory.' },
    },
    required: ['run', 'role', 'task', 'agent', 'header'],
    additionalProperties: false,
  },
}

export const CLOSE_TOOL = {
  name: 'close_pane',
  description: 'Close one agentille worker pane this session opened (an agt-<run>-<role> pane in this tab or window) after you have read its result. Panes opened by a typed /agt-spawn and panes of other sessions are refused.',
  inputSchema: {
    type: 'object',
    properties: { name: { type: 'string', description: 'The pane name, agt-<run>-<role>.' } },
    required: ['name'],
    additionalProperties: false,
  },
}

// spawn_pane input → { run, role, name, agent, header, hdr, asked, model, task, cwd } or { error }. `live` is the
// panes the mod sees now; a name already on screen is refused rather than doubled.
export function spawnToolInput(input, live = []) {
  const i = input ?? {}
  const str = (v) => (typeof v === 'string' ? v.trim() : '')
  const run = str(i.run)
  const role = str(i.role)
  const task = str(i.task)
  const agent = str(i.agent)
  const header = str(i.header)
  const asked = str(i.model) || null
  const model = asked ?? DEFAULT_MODEL
  const cwd = i.cwd === undefined ? null : str(i.cwd)
  if (!SAFE_RUN.test(run)) return { error: 'run must be the run id from the [agt run=…] header.' }
  if (!ROLE_RE.test(role)) return { error: 'role must be lowercase letters, digits and dashes.' }
  if (role === SPAWN_ROLE) return { error: '"spawn" is reserved for a typed /agt-spawn.' }
  const name = paneName(run, role)
  if (!name) return { error: 'agt-' + run + '-' + role + ' is not a valid pane name (max 32 chars).' }
  if (!ROLES.includes(agent)) return { error: 'agent must be one of ' + ROLES.join(', ') + '.' }
  const hdr = parseHeader(header)
  if (!hdr) return { error: 'header must be the run\'s [agt run=… …] line.' }
  if (hdr.run !== run) return { error: 'header run=' + hdr.run + ' does not match run ' + run + '.' }
  if (!TOOL_MODELS.includes(model)) return { error: 'model must be one of ' + TOOL_MODELS.join(', ') + '. Fable runs only through the routing guard or a typed /agt-spawn.' }
  if (!task) return { error: 'task is empty.' }
  if (BARE_WORD.test(task)) return { error: 'A one-word task would run as a claude subcommand. Send the full worker prompt.' }
  if (cwd !== null && (!cwd.startsWith('/') || cwd.includes('\0'))) return { error: 'cwd must be an absolute path.' }
  if (live.some((p) => p.name === name)) return { error: name + ' is already open. Pick another role or close it first.' }
  return { run, role, name, agent, header, hdr, asked, model, task, cwd }
}

// close_pane input → { pane } from the panes this session owns, or { error }. `tab`, when
// given, keeps a herdr close inside the lead's own tab.
export function closeTarget(input, live = [], tab = null) {
  const name = typeof input?.name === 'string' ? input.name.trim() : ''
  const n = splitName(name)
  if (!n) return { error: 'name must be an agt-<run>-<role> pane name.' }
  if (n.role === SPAWN_ROLE) return { error: name + ' was opened by a typed /agt-spawn; it is the person\'s to close.' }
  const pane = live.find((p) => p.name === name && (tab === null || p.tab === tab))
  return pane ? { pane } : { error: 'No pane named ' + name + ' in this tab or window.' }
}
