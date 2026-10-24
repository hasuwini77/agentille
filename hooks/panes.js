// Pane transport: which multiplexer this session runs in (Herdr, tmux, or none), how to
// open a worker pane in it, and how to read tmux panes back as live.js pane agents.
// Pure on purpose — the hooks loader never follows `$` across an import — so every
// $.process / $.env / $.fs call lives in the modules that run them (spawn.js, reaper.js, sessions.js, tools.js)
// and only feeds these helpers. The long text the model reads is in text.js.

import { ROLES, parseHeader, sessionAskSpans } from './routing.js'
import { SPAWN_TOOL_TEXT, CLOSE_TOOL_TEXT, sessionsToolText, sessionsNoteText, SESSIONS_ON_REQUEST, PANE_RULE, NO_TRANSPORT } from './text.js'

export const SAFE_RUN = /^[A-Za-z0-9_-]{1,64}$/
export const NAME_RE = /^[a-z][a-z0-9_-]{0,31}$/
const ROLE_RE = /^[a-z0-9-]+$/
const PANE_KEY = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/
const MODEL_LIKE = /^[A-Za-z0-9][\w.-]*$/
const BARE_WORD = /^[a-z-]+$/
const MODEL_RE = /^(haiku|sonnet|opus|fable|claude-[a-z0-9.-]+)$/
export const PROBE = { timeoutMs: 5000 }
export const HERDR_START_TIMEOUT = { timeoutMs: 60000 }
const TAB = '\t'
const TAB_ID = /^[A-Za-z0-9:_-]+$/

export const SPAWN_ROLE = 'spawn'
export const DEFAULT_MODEL = 'sonnet'
export const SPAWN_USAGE = 'Usage: /agt-spawn "task" [--model sonnet|opus|haiku|fable]'

// herdr when HERDR_ENV=1 and `herdr --version` ran; else tmux when $TMUX is set and
// `tmux -V` ran; else none. Callers pass what their probes found (a probe that rejects
// or exits non-zero is false).
export function pickTransport({ herdrOk, tmuxOk }) {
  return herdrOk ? 'herdr' : tmuxOk ? 'tmux' : 'none'
}

export { PANE_RULE }

// The block appended to the /agt skill prompt: which transport is live and, when the mod
// registered the pane tools, the rule for using them.
export function transportBlock(transport, tools = false) {
  const note = transport === 'none' ? NO_TRANSPORT + '\n' : tools ? PANE_RULE + '\n' : ''
  return '\n## Pane transport (agentille mod)\n\ntransport: ' + transport + '\n' + note
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

// A pane id made filename-safe: herdr w1:p3 → w1-p3, tmux %5 → 5. null when nothing safe is left.
// The key names a pane instance's own answer file, so a respawned role never reads its predecessor's.
export function paneKey(id) {
  const key = String(id ?? '').replace(/[^A-Za-z0-9_-]/g, '-').replace(/^-+|-+$/g, '')
  return PANE_KEY.test(key) ? key : null
}

// Where a worker saves its full answer: one file per pane instance (pane-<role>.<key>.md). With no key,
// the legacy pane-<role>.md an older worker writes. null for an unsafe run, role or key.
export function answerFile(home, run, role, key = null) {
  if (!home || !SAFE_RUN.test(run) || !ROLE_RE.test(role) || (key !== null && !PANE_KEY.test(key))) return null
  return home + '/.agentille/state/run-' + run + '/agents/pane-' + role + (key === null ? '' : '.' + key) + '.md'
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

// /agt-spawn panes are the person's, not a run's: SHOWN as `open`, never as working or done, so they
// feed no spinner, busy timer or working count. Display only: the reaper is fed the real state.
export function quietSpawn(panes) {
  return panes.map((p) => (p.role === SPAWN_ROLE ? { ...p, state: 'open', seq: 0 } : p))
}

// tmux rows → live.js pane agents. `done` maps pane name → whether a fresh done-file exists.
// A pane is done when that holds or tmux says it is dead; seq is synthesized for reapPlan().
// Real states: apply quietSpawn() for display only.
export function tmuxPaneAgents(rows, selfPane, done) {
  return (scopeRows(rows, selfPane).map((r) => {
    const n = splitName(r.agt)
    const finished = r.dead || done.get(r.agt) === true
    return { id: r.id, kind: 'pane', name: r.agt, role: n?.role ?? r.agt, run: n?.run ?? '', vendor: r.vendor || 'claude', state: finished ? 'done' : 'working', seq: finished ? 1 : 0, tab: r.window, workspace: null }
  }))
}

// Only a pane with no @agt name of its own is a lead; workers never reap.
export function rowIsLead(rows, selfPane) {
  const me = rows.find((r) => r.id === selfPane)
  return !!me && !me.agt.startsWith('agt-')
}

export const TMUX_LIST_ARGV = ['tmux', 'list-panes', '-a', '-F', TMUX_LIST_FORMAT]

// ── reaping ───────────────────────────────────────────────────────────────────

// The panes offered to the reaper: every agt- pane, /agt-spawn ones included, with their real state.
// A spawn pane closes like any worker once it is done/idle and its answer is saved.
export function reapPool(panes) {
  return [...panes]
}

// ── spawning ──────────────────────────────────────────────────────────────────

export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max']
const effortArgs = (effort) => (EFFORTS.includes(effort) ? ['--effort', effort] : [])
// A routed worker runs as its agentille agent definition (instructions, tools, verdict format),
// not as a bare session that only has the task prompt.
const agentArgs = (agent) => (ROLES.includes(agent) ? ['--agent', 'agentille:agentille-' + agent] : [])

// Claude Code's advisor attaches to every session from the user's settings. With
// profile.routing.advisorOnOpus false, an Opus or Fable worker runs without one.
export const advisorEnv = (model, settings) => (settings?.advisorOnOpus === false && (model === 'opus' || model === 'fable') ? ['CLAUDE_CODE_DISABLE_ADVISOR_TOOL=1'] : [])

// Who the worker is, for its own mascot band: <agent>:<model>:<effort>. A typed /agt-spawn has no agent.
export const workerEnv = ({ agent, model, effort }) => 'AGENTILLE_WORKER=' + [agent || SPAWN_ROLE, model, EFFORTS.includes(effort) ? effort : ''].join(':')

export function tmuxSplitArgv({ target, cwd, run, shell, model, name, task, effort, direction, agent, env = [] }) {
  const head = ['tmux', 'split-window', '-d', direction === 'down' ? '-v' : '-h', '-P', '-F', '#{pane_id}', '-t', target, '-c', cwd.replace(/#/g, '##'), '-e', 'AGENTILLE_RUN=' + run, '-e', workerEnv({ agent, model, effort }), ...env.flatMap((v) => ['-e', v])]
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
export function herdrSplitArgv({ pane, cwd, run, direction, agent, model, effort, env = [] }) {
  return ['herdr', 'pane', 'split', '--pane', pane, '--direction', direction === 'down' ? 'down' : 'right', '--cwd', cwd, '--env', 'AGENTILLE_RUN=' + run, '--env', workerEnv({ agent, model, effort }), ...env.flatMap((v) => ['--env', v]), '--no-focus']
}

export function herdrPaneIdOf(stdout) {
  try {
    return JSON.parse(stdout).result?.pane?.pane_id ?? null
  } catch {
    return null
  }
}

export const VENDORS = ['claude', 'codex']
export const LAYOUTS = ['stack', 'tab']
// Codex starts on the person's own config (model, sandbox, approvals); only the update nag is switched off.
// herdr: a new tab for a whole run, labelled agt-<run>, never focused. Same env as a split pane.
export function herdrTabArgv({ workspace, cwd, run, agent, model, effort, env = [] }) {
  return ['herdr', 'tab', 'create', '--workspace', workspace, '--cwd', cwd, '--label', 'agt-' + run, '--env', 'AGENTILLE_RUN=' + run, '--env', workerEnv({ agent, model, effort }), ...env.flatMap((v) => ['--env', v]), '--no-focus']
}

// tab create stdout → { tab, pane } (the new tab and its root pane), else null.
export function herdrTabOf(stdout) {
  try {
    const r = JSON.parse(stdout).result
    const tab = r?.tab?.tab_id
    const pane = r?.root_pane?.pane_id
    return TAB_ID.test(tab ?? '') && typeof pane === 'string' && pane ? { tab, pane } : null
  } catch {
    return null
  }
}

export const herdrTabListArgv = (workspace) => ['herdr', 'tab', 'list', '--workspace', workspace]

// tab list stdout → the tab ids herdr still has, or null when the answer is unreadable.
export function herdrTabIds(stdout) {
  try {
    return JSON.parse(stdout).result.tabs.map((t) => t.tab_id).filter((id) => TAB_ID.test(id ?? ''))
  } catch {
    return null
  }
}

// Where a lead keeps the ids of the run tabs it made, so the SessionEnd sweep can find them.
export function tabsFile(home, leadPane) {
  const key = paneKey(leadPane)
  return home && key ? home + '/.agentille/state/lead-' + key + '.tabs' : null
}
// The worker pane names this lead opened, one per line: the SessionEnd sweep and a restarted lead read them, so
// neither touches a pane some other session opened in the same tab.
export function panesFile(home, leadPane) {
  const key = paneKey(leadPane)
  return home && key ? home + '/.agentille/state/lead-' + key + '.panes' : null
}

// One tab id per line; anything that is not a tab id is dropped.
export const tabIdsOf = (text) => String(text ?? '').split('\n').map((l) => l.trim()).filter((l) => TAB_ID.test(l))

// Layout: a heavy run may take its own tab on herdr; tmux and the default stack in the lead's tab or window.
// `opened` is { id, run, tab? }: a run tab is live while one of its panes is.
export function placePlan({ transport, layout, run, lead, opened = [], live = [] }) {
  const alive = (o) => live.some((p) => p.id === o.id)
  if (transport === 'herdr' && layout === 'tab') {
    const mine = opened.filter((o) => o.run === run && o.tab && alive(o))
    return mine.length ? { target: mine[mine.length - 1].id, direction: 'down', tab: mine[0].tab } : { newTab: true }
  }
  return splitPlan({ lead, opened: opened.filter((o) => !o.tab), live })
}

// ── startup dialogs: a fresh worker can stop on a screen only a keypress clears ─────────

// A screen read from a blocked worker → 'trust' | 'update' | null.
export function startupDialog(text) {
  const t = String(text ?? '')
  if (/Update available/i.test(t) && /\bSkip\b/.test(t)) return 'update'
  if (/Do you trust the (contents of this directory|files in this folder)\?|Is this a project you created or one you trust\?/i.test(t)) return 'trust'
  return null
}

// The keys that move a trust menu's cursor (❯ or ›) onto its Yes line, then confirm. Claude preselects
// "No, exit" and Codex "Yes", so the move is read off the screen. null when either line is missing.
export function trustKeys(text) {
  const lines = String(text ?? '').split('\n')
  const cur = lines.findIndex((l) => /^\s*[❯›]\s/.test(l))
  const yes = lines.findIndex((l) => /^\s*[❯›]?\s*(\d+\.\s*)?Yes\b/.test(l))
  if (cur < 0 || yes < 0) return null
  return [...Array(Math.abs(yes - cur)).fill(yes > cur ? 'down' : 'up'), 'enter']
}

// Trust: the preselected "Yes" takes Enter. Update: the second row, Skip.
export const dialogKeys = (kind, text = '') => (kind === 'trust' ? trustKeys(text) ?? [] : kind === 'update' ? ['down', 'enter'] : [])

export const herdrReadArgv = (name) => ['herdr', 'agent', 'read', name, '--source', 'detection', '--lines', '40']
export const herdrKeysArgv = (name, keys) => ['herdr', 'agent', 'send-keys', name, ...keys]
// agent wait stdout → the agent's status (idle, done, blocked, …), or null.
export function agentStatusOf(stdout) {
  try {
    return JSON.parse(stdout).result?.agent?.agent_status ?? null
  } catch {
    return null
  }
}

// `agent wait` returns a stale `blocked` at once after a dialog clears, so the lead polls `agent get` instead.
export const herdrGetArgv = (name) => ['herdr', 'agent', 'get', name]

// The line to show when a screen is not a known dialog: its first non-empty line, 120 chars at most.
export const screenLine = (text) => String(text ?? '').split('\n').map((l) => l.trim()).find(Boolean)?.slice(0, 120) ?? 'the pane is blocked on an unknown screen'

// What Codex is asked to do last, so the harvest, reaper and wake paths find its answer like a Claude pane's.
// A Codex pane has no wire and a session cannot message itself, so the lead waits on it in the background:
// that command's exit is what wakes the lead.
export const codexNote = (name, file) => ' Codex sends no report: run `herdr agent wait ' + name + ' --until done --until blocked --timeout 3600000` in the background now; when it exits, read ' + file + ', then close_pane if it is still open.'
export const codexTask = (task, file) => task + '\n\nWhen you finish, write your complete final report to ' + file + ' and stop.'

export const herdrStartArgv = ({ name, pane, model, effort, agent, vendor }) => (vendor === 'codex'
  ? ['herdr', 'agent', 'start', name, '--kind', 'codex', '--pane', pane, '--timeout', '45000', '--', '-c', 'check_for_update_on_startup=false']
  : ['herdr', 'agent', 'start', name, '--kind', 'claude', '--pane', pane, '--timeout', '45000', '--', ...agentArgs(agent), '--model', model, ...effortArgs(effort)])
export const herdrPromptArgv = (name, task) => ['herdr', 'agent', 'prompt', name, task]
export const herdrCloseArgv = (id) => ['herdr', 'pane', 'close', id]

// Herdr's sidebar label for a worker pane (display-only; a failure changes nothing).
export function herdrMetaArgv(pane, { display = null, title = null } = {}) {
  // herdr reads the pane id before the options
  const argv = ['herdr', 'pane', 'report-metadata', pane, '--source', 'agentille']
  if (display) argv.push('--display-agent', String(display).slice(0, 48))
  if (title) argv.push('--title', String(title).slice(0, 64))
  return argv.length > 6 ? argv : null
}

// Jump to a worker from its band row: Herdr focuses the agent by name, tmux selects the pane.
export function focusArgv(transport, pane) {
  if (transport === 'herdr' && pane?.name) return ['herdr', 'agent', 'focus', pane.name]
  if (transport === 'tmux' && /^%\d+$/.test(String(pane?.id ?? ''))) return ['tmux', 'select-pane', '-t', pane.id]
  return null
}

// Whether a routing role runs as a pane worker: only an executor or the adversary. Reviewers and the
// planning roles stay subagents: their flags, token counts and full answers exist only there.
export function paneRole(agent) {
  return agent === 'executor' || agent === 'adversary'
    ? { pane: true, why: '' }
    : { pane: false, why: `${agent} runs as a subagent: only an executor or the adversary gets a pane.` }
}

// ── pane tools: the /agt heavy level opens and closes workers through the mod ──────

// Fable is not offered: on a tool it would skip the routing guard. A typed /agt-spawn may still pick it.
export const TOOL_MODELS = ['sonnet', 'opus', 'haiku']

export const SPAWN_TOOL = {
  name: 'spawn_pane',
  isDeferred: false,
  description: SPAWN_TOOL_TEXT,
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
      layout: { type: 'string', enum: LAYOUTS, description: '"tab": on Herdr, this run\'s workers share a new tab of their own. Default "stack" (lead\'s tab); tmux ignores it.' },
      vendor: { type: 'string', enum: VENDORS, description: '"codex": run this executor in Codex on your own Codex config (Herdr only). Default "claude".' },
    },
    required: ['run', 'role', 'task', 'agent', 'header'],
    additionalProperties: false,
  },
}

export const CLOSE_TOOL = {
  name: 'close_pane',
  isDeferred: false,
  description: CLOSE_TOOL_TEXT,
  inputSchema: {
    type: 'object',
    properties: { name: { type: 'string', description: 'The pane name, agt-<run>-<role> or s-<run>-<n>.' } },
    required: ['name'],
    additionalProperties: false,
  },
}

// spawn_pane input → { run, role, name, agent, header, hdr, asked, model, task, cwd, layout, vendor } or { error }. `live` is the
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
  const layout = i.layout === undefined ? 'stack' : str(i.layout)
  const vendor = i.vendor === undefined ? 'claude' : str(i.vendor)
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
  if (!LAYOUTS.includes(layout)) return { error: 'layout must be one of ' + LAYOUTS.join(', ') + '.' }
  if (!VENDORS.includes(vendor)) return { error: 'vendor must be one of ' + VENDORS.join(', ') + '.' }
  if (vendor === 'codex' && agent !== 'executor') return { error: 'vendor codex is for the executor only; ' + agent + ' runs on Claude.' }
  if (!task) return { error: 'task is empty.' }
  if (BARE_WORD.test(task)) return { error: 'A one-word task would run as a claude subcommand. Send the full worker prompt.' }
  if (cwd !== null && (!cwd.startsWith('/') || cwd.includes('\0'))) return { error: 'cwd must be an absolute path.' }
  if (live.some((p) => p.name === name)) return { error: name + ' is already open. Pick another role or close it first.' }
  return { run, role, name, agent, header, hdr, asked, model, task, cwd, layout, vendor }
}

// close_pane input → { pane } from the panes this session owns, or { error }. `tab`, when
// given (one id or a list), keeps a herdr close inside the lead's own tab and the run tabs it made.
// `mine`: names this lead opened. One the reaper already closed after harvest is `gone`, not an error: the lead's
// close-after-harvest then still reads as done.
export function closeTarget(input, live = [], tab = null, mine = new Set()) {
  const tabs = tab === null ? null : [tab].flat()
  const name = typeof input?.name === 'string' ? input.name.trim() : ''
  const n = splitName(name)
  if (!n) return { error: 'name must be an agt-<run>-<role> pane name.' }
  if (n.role === SPAWN_ROLE) return { error: name + ' was opened by a typed /agt-spawn; only the automatic reaper closes it.' }
  const pane = live.find((p) => p.name === name && (tabs === null || tabs.includes(p.tab)))
  if (pane) return { pane }
  if (mine.has(name) && !live.some((p) => p.name === name)) return { gone: name }
  return { error: 'No pane named ' + name + ' in this tab or window.' }
}

// ── sessions: interactive panes the person asked for, not workers ──────────────

// What open_sessions can start. A session is the person's own, like a pane they opened by hand: no agt- name,
// no worker env and no wire, so the band and the worker reaper never touch it. Only a Herdr Claude or Codex session
// is ever closed for the person: by the lead after SESSION_IDLE_MS idle and unfocused (sessionSweep), at session end
// when idle (the SessionEnd sweep, from the lead's own lead-<pane>.sessions list), and by /agt-clean when idle after
// its lead died. A shell, and any tmux session, closes only on request.
export const SESSION_KINDS = ['claude', 'codex', 'shell']
export const MAX_SESSIONS = 8
// A resting session closes after this long: time to read an answer and type the next prompt.
export const SESSION_IDLE_MS = 10 * 60_000

// s-<run>-<n>: unique per herdr server through the run id, and never agt-.
export function sessionName(run, i) {
  const name = 's-' + run + '-' + i
  return SAFE_RUN.test(run) && Number.isInteger(i) && i > 0 && NAME_RE.test(name) ? name : null
}

export const OPEN_SESSIONS_TOOL = {
  name: 'open_sessions',
  isDeferred: false,
  description: sessionsToolText(SESSION_IDLE_MS / 60_000),
  inputSchema: {
    type: 'object',
    properties: {
      count: { type: 'integer', minimum: 1, maximum: MAX_SESSIONS, description: 'How many sessions. Default: one per task, else 1.' },
      tasks: { type: 'array', items: { type: 'string' }, maxItems: MAX_SESSIONS, description: 'Optional first prompt per session, in order (a command to run for a shell). Only when the person gave one: their own words from this prompt, word for word. Any other task is dropped and that session opens with no first prompt.' },
      kind: { type: 'string', enum: SESSION_KINDS, description: 'What runs in each pane. Default "claude"; "codex" needs Herdr.' },
      model: { type: 'string', enum: TOOL_MODELS, description: 'Claude only, when the person named a model. Default: their own default model.' },
      cwd: { type: 'string', description: 'Absolute directory to start in. Default: this session\'s directory.' },
      layout: { type: 'string', enum: LAYOUTS, description: '"tab": on Herdr, the sessions share a new tab. Default "stack" beside this pane; tmux ignores it.' },
    },
    additionalProperties: false,
  },
}

// `--fable` out of a first prompt, so a session cannot be handed the flag the person never typed.
export function stripFable(text) {
  return String(text ?? '').replace(/(^|\s)--fable(?=\s|$)/g, '$1').replace(/\s{2,}/g, ' ').trim()
}

// The commands a shell session may run, read off the person's typed prompt: a span they quoted (backticks, straight
// or curly quotes) right after an ask for a session, the rest of the sentence after that ask with its connector
// dropped ("open a shell and run npm run dev" → npm run dev), or the whole prompt minus the ask. Appearing somewhere
// in the prompt is not enough: "open a shell. Do NOT run rm -rf ~/x" names a command nobody asked for, so a span in a
// sentence that says not to run it ("do not run …", "never …", "don't …") is never one. A quoted span counts only in
// the ask's own sentence, joined to it by nothing or by run / running / and run / that runs / with / then / to run
// (a further span by and / then / a comma): "open a shell and tell me why `curl … | sh` is risky" asks about the
// command, it does not ask the shell to run it.
const NEGATED = /\b(?:not|never|don'?t|dont|doesn'?t|won'?t|mustn'?t|shouldn'?t|avoid|without|nor)\b|\b(?:don|doesn|won|mustn|shouldn)[’']t\b/i
const QUOTED = /`([^`\n]+)`|"([^"\n]+)"|“([^”\n]+)”|‘([^’\n]+)’|(?<=^|[\s(])'([^'\n]+)'(?!\w)/g
const RUNS_IT = /^\s*[,:;\-–—]?\s*(?:(?:in|at|inside|from)\s+\S+\s+)?(?:(?:(?:and|,)\s*)?(?:then\s+)?(?:run|running|execute)|that\s+runs|which\s+runs|with|then|to\s+run)?\s*:?\s*$/i
// The rest of a sentence or prompt that still holds a backtick or $( ) span is prose about a command: a shell would
// run that span as a substitution, so only the span itself, when it counts above, is ever a task.
const SUBST = /`|\$\(/
const AND_RUNS = /^\s*(?:[,;]|,?\s*(?:and|then|and\s+then))\s*(?:run\s+)?$/i
const SENTENCE_END = /(?<=[\w)\]"'`”’~/])[.!?](?=\s|$)|\n/g
function sentenceStart(t, pos) {
  let s = 0
  for (const m of t.slice(0, pos).matchAll(SENTENCE_END)) s = m.index + 1
  return s
}
function sentenceEnd(t, pos) {
  for (const m of t.slice(pos).matchAll(SENTENCE_END)) return pos + m.index
  return t.length
}
function bareCommand(s) {
  let c = String(s).trim().replace(/^(?:in|at|inside|from)\s+\S+(?=\s|$)/i, '').trim()
  for (;;) {
    const n = c.replace(/^[,:;\-–—]\s*/, '').replace(/^(?:and|then|to|that|which|so|also|please)\s+/i, '').replace(/^(?:runs?|running|execute|exec)\s+/i, '')
    if (n === c) break
    c = n
  }
  c = c.replace(/\s+(?:in\s+it|in\s+there|there|for\s+me|please|now)$/i, '').replace(/(?<=\w)[.!?]$/, '').trim()
  const q = /^([`"'\u201c\u2018])([^`"'\u201c\u201d\u2018\u2019]+)([`"'\u201d\u2019])$/.exec(c) // a quoted command runs bare
  return q ? q[2].trim() : c
}
// A bare (unquoted) candidate is a command only when it reads as one: it starts like a command word, and outside its
// quotes it holds no clause break (`;`, `, `, a sentence end, a lone and / then / but / or) and no prose word ("is",
// "what", "I", "my" …). The candidate is refused whole, never cut short: cutting "git push --force origin main was
// the mistake yesterday; explain …" at its first break would mint a command nobody asked a shell to run.
const PROSE_WORDS = new Set(['is', 'was', 'were', 'are', 'am', 'be', 'been', 'would', 'should', 'could', 'can', 'might', 'shall', 'must', 'what', 'why', 'how', 'when', 'whether', 'because', 'my', 'me', 'mine', 'you', 'your', 'we', 'our', 'it', 'its', "it's", "that's", "what's", "i'm", "i've", 'this', 'these', 'those', 'wondering', 'think', 'explain', 'mistake', 'yesterday', 'please'])
const CLAUSE_BREAK = /;|,\s|(?<=[\w)\]"'])[.!?](?=\s|$)|\s(?:and|then|but|or)(?=\s|$)/i
function looksLikeCommand(c) {
  const bare = c.replace(/`[^`]*`|"[^"]*"|'[^']*'|“[^”]*”|‘[^’]*’/g, 'Q')
  if (!/^[\w~/$.(]/.test(bare) || /^\.(?:\s|$)/.test(bare) || CLAUSE_BREAK.test(bare)) return false
  return !bare.split(/\s+/).some((w) => w === 'I' || PROSE_WORDS.has(w.toLowerCase().replace(/[^\w']+$/, '')))
}
export function shellCommands(typed) {
  const t = String(typed ?? '')
  const out = new Set()
  const asks = sessionAskSpans(t)
  const quoted = [...t.matchAll(QUOTED)]
  for (const a of asks) {
    let from = a.end
    for (const m of quoted) {
      if (m.index < from) continue
      if (!(from === a.end ? RUNS_IT : AND_RUNS).test(t.slice(from, m.index))) break
      const span = (m[1] ?? m[2] ?? m[3] ?? m[4] ?? m[5]).trim()
      if (span && !NEGATED.test(t.slice(sentenceStart(t, m.index), m.index))) out.add(span)
      from = m.index + m[0].length
    }
  }
  for (const a of asks) {
    const rest = t.slice(a.end, sentenceEnd(t, a.end))
    const c = bareCommand(rest)
    if (c && !SUBST.test(c) && looksLikeCommand(c) && !NEGATED.test(t.slice(sentenceStart(t, a.start), a.end) + rest)) out.add(c)
    const whole = t.slice(0, a.start) + ' ' + t.slice(a.end)
    const w = bareCommand(whole)
    if (w && !SUBST.test(w) && looksLikeCommand(w) && !NEGATED.test(whole)) out.add(w)
  }
  return out
}

// The first prompts a Claude or Codex session may get, read off the person's typed prompt like a shell's commands:
// the prompt with its asks for sessions taken out (so a list on the lines after "open two sessions:" counts), cut
// into clauses at sentence ends, new lines, `;`, `, `, `: ` and a lone and / then / but. A task is one clause or a run
// of clauses, word for word (case, spacing, a trailing stop, a list bullet and enclosing quotes aside), with or
// without leading glue such as "one to", "and ask it to", "with the prompt", "on opus to". A clause whose own sentence says not
// to ("do not …", "never …") before it starts is never a prompt on its own: "Do not git push origin main" does not
// yield `git push origin main`. Returns the set of normalised forms.
const CLAUSE_SPLIT = /(?<=[\w)\]"'`”’~/])[.!?](?=\s|$)|\n|;|,(?=\s)|:(?=\s)|\s(?:and\s+then|and|then|but)(?=\s)/gi
const GLUE = /^(?:(?:and|then|also|so|please|now|next|first|second|third|one|another|the\s+other|the\s+(?:first|second|third|next|last)(?:\s+one)?|to|that|which|for|with(?:\s+(?:the|a))?|(?:first\s+)?(?:prompt|task|message)(?:\s+(?:of|is))?|saying|that\s+says|(?:ask|tell|get|have|let|make|send|give|prompt)\s+(?:it|them|each|one|both)(?:\s+to)?|running|run|(?:on|in|at|inside|from|using)\s+\S+)(?=\s|$)|[:\-–—])\s*/i
const MAX_RUN = 12
const normTask = (s) => {
  let x = String(s).replace(/\s+/g, ' ').trim().replace(/[.!?]+$/, '').trim().replace(/^(?:[-*•]|\d+[.)])\s+/, '')
  const q = /^([`"'“‘])(.+)([`"'”’])$/.exec(x)
  if (q) x = q[2].trim()
  return x.toLowerCase()
}
export function sessionPrompts(typed) {
  const raw = String(typed ?? '')
  let t = raw
  for (const a of sessionAskSpans(raw)) t = t.slice(0, a.start) + '\n'.padEnd(a.end - a.start, ' ') + t.slice(a.end)
  const clauses = []
  let at = 0
  for (const m of t.matchAll(CLAUSE_SPLIT)) {
    clauses.push([at, m.index])
    at = m.index + m[0].length
  }
  clauses.push([at, t.length])
  const out = new Set()
  for (let i = 0; i < clauses.length; i++) {
    if (NEGATED.test(t.slice(sentenceStart(t, clauses[i][0]), clauses[i][0]))) continue
    for (let j = i; j < clauses.length && j - i < MAX_RUN; j++) {
      let v = normTask(t.slice(clauses[i][0], clauses[j][1]))
      while (v) {
        out.add(v)
        const n = normTask(v.replace(GLUE, ''))
        if (n === v) break
        v = n
      }
    }
  }
  return out
}

// A typed /storm hands its picks to one Claude session as `/agt heavy "…"` (`/agt medium` for quick), a line the
// skill writes (skills/storm/handoff.md → "agt task line"), so on a /storm turn that one shape is a first prompt the
// person asked for: it starts a typed /agt run in that session, under that session's own guard. Same test for a
// typed /storm as routing.js asksSessions.
const STORM_TYPED = /^\s*\/(?:agentille:)?storm\b/
const STORM_HANDOFF = /^\/(?:agentille:)?agt\s+(?:heavy|medium)\s+"[^\n]+"$/

// open_sessions input → { count, tasks, kind, model, cwd, layout, dropped } or { error }. `tasks` has one entry per
// session, null where none was given. `typed` is the person's own prompt, and a session is the person's, with no Bash
// guard in it, so a first prompt is never the model's own: a shell command runs only when it is one of
// shellCommands, a Claude or Codex prompt only when it is one of sessionPrompts (or /storm's hand-off line on a typed
// /storm). Any other task is dropped, the
// session opens with no first prompt, and `dropped` says which and why. `--fable` rides into a Claude or Codex
// session only when `fableTyped` says the person typed it.
export function sessionsToolInput(input, { typed = '', fableTyped = false } = {}) {
  const i = input ?? {}
  const str = (v) => (typeof v === 'string' ? v.trim() : '')
  const given = i.tasks === undefined ? [] : i.tasks
  if (!Array.isArray(given) || given.some((t) => typeof t !== 'string')) return { error: 'tasks must be a list of strings.' }
  const count = i.count === undefined ? Math.max(1, given.length) : i.count
  const kind = i.kind === undefined ? 'claude' : str(i.kind)
  const model = i.model === undefined ? null : str(i.model)
  const cwd = i.cwd === undefined ? null : str(i.cwd)
  const layout = i.layout === undefined ? 'stack' : str(i.layout)
  if (!Number.isInteger(count) || count < 1 || count > MAX_SESSIONS) return { error: 'count must be a whole number from 1 to ' + MAX_SESSIONS + '.' }
  if (given.length > count) return { error: given.length + ' tasks for ' + count + ' sessions: give one task per session at most.' }
  if (!SESSION_KINDS.includes(kind)) return { error: 'kind must be one of ' + SESSION_KINDS.join(', ') + '.' }
  if (model !== null && !TOOL_MODELS.includes(model)) return { error: 'model must be one of ' + TOOL_MODELS.join(', ') + '.' }
  if (model !== null && kind !== 'claude') return { error: 'model applies to Claude sessions only.' }
  if (!LAYOUTS.includes(layout)) return { error: 'layout must be one of ' + LAYOUTS.join(', ') + '.' }
  if (cwd !== null && (!cwd.startsWith('/') || cwd.includes('\0'))) return { error: 'cwd must be an absolute path.' }
  let tasks = Array.from({ length: count }, (_, n) => str(given[n]) || null)
  const dropped = []
  const drop = (n, why) => {
    dropped.push({ n, task: tasks[n], why })
    tasks[n] = null
  }
  if (kind === 'shell') {
    const ok = shellCommands(typed)
    tasks.forEach((t, n) => t && !ok.has(t) && drop(n, 'a shell command runs only as the person typed it, and this is not a command they quoted or asked a shell to run'))
  } else {
    const ok = sessionPrompts(typed)
    const storm = kind === 'claude' && STORM_TYPED.test(String(typed ?? ''))
    tasks.forEach((t, n) => t && !(storm && STORM_HANDOFF.test(t)) && !ok.has(normTask(t)) && !ok.has(normTask(stripFable(t))) && drop(n, 'a first prompt runs only as the person typed it, and this is not in their newest prompt word for word'))
    if (!fableTyped) tasks = tasks.map((t) => (t ? stripFable(t) || null : t))
  }
  if (kind === 'claude' && tasks.some((t) => t && BARE_WORD.test(t))) return { error: 'A one-word task would run as a claude subcommand. Say more.' }
  return { count, tasks, kind, model, cwd, layout, dropped }
}

// What the tool result says about tasks sessionsToolInput dropped: the session opened anyway, with no first prompt.
export function droppedNote(dropped, names) {
  if (!dropped?.length) return ''
  return dropped.filter((d) => names[d.n]).map((d) => ' ' + names[d.n] + ' opened with no first prompt: "' + String(d.task).slice(0, 60) + '" was dropped (' + d.why + '). The person can type it there.').join('')
}

// herdr: a plain split or tab, with none of a worker's env.
export const herdrSessionSplitArgv = ({ pane, cwd, direction }) => ['herdr', 'pane', 'split', '--pane', pane, '--direction', direction === 'down' ? 'down' : 'right', '--cwd', cwd, '--no-focus']
export const herdrSessionTabArgv = ({ workspace, cwd, label }) => ['herdr', 'tab', 'create', '--workspace', workspace, '--cwd', cwd, '--label', label, '--no-focus']

export const herdrSessionStartArgv = ({ name, pane, kind, model }) => (kind === 'codex'
  ? ['herdr', 'agent', 'start', name, '--kind', 'codex', '--pane', pane, '--timeout', '45000', '--', '-c', 'check_for_update_on_startup=false']
  : ['herdr', 'agent', 'start', name, '--kind', 'claude', '--pane', pane, '--timeout', '45000', '--', ...(model ? ['--model', model] : [])])
export const herdrRunArgv = (pane, command) => ['herdr', 'pane', 'run', pane, command]
export const herdrPaneGetArgv = (pane) => ['herdr', 'pane', 'get', pane]

// A pane's terminal id from split, tab create or pane get stdout: herdr can hand a closed pane's id out again,
// the terminal id never repeats. null when unreadable.
export function herdrTerminalOf(stdout) {
  try {
    const r = JSON.parse(stdout).result
    const t = (r?.pane ?? r?.root_pane)?.terminal_id
    return typeof t === 'string' && t ? t : null
  } catch {
    return null
  }
}

// tmux: a plain split running claude (the task as its first prompt) or the person's shell. tmux pane ids never repeat.
export function tmuxSessionSplitArgv({ target, cwd, direction, shell, kind, model, task }) {
  const head = ['tmux', 'split-window', '-d', direction === 'down' ? '-v' : '-h', '-P', '-F', '#{pane_id}', '-t', target, '-c', cwd.replace(/#/g, '##')]
  if (kind !== 'claude') return head
  const tail = [...(model ? ['--model', model] : []), ...(task ? ['--', task] : [])]
  const base = String(shell ?? '').split('/').pop()
  if (base === 'zsh' || base === 'bash') return [...head, shell, '-ic', 'claude "$@"', 's', ...tail]
  return [...head, 'claude', ...tail]
}

export const tmuxTitleArgvs = (id, name) => [
  ['tmux', 'set-option', '-p', '-t', id, 'allow-set-title', 'off'],
  ['tmux', 'select-pane', '-t', id, '-T', name],
]
export const tmuxTypeArgvs = (id, command) => [['tmux', 'send-keys', '-t', id, '-l', '--', command], ['tmux', 'send-keys', '-t', id, 'Enter']]

// The Herdr sessions a lead closes now: an agent idle (its answer seen) and unfocused for SESSION_IDLE_MS. A `done`
// agent holds an answer nobody has looked at yet, so it stays. A shell is never closed for the person, and neither is a
// session whose agent left (claude exited to a bare shell the person may be using). `since` maps name → when it was
// first seen resting, updated in place.
export function sessionSweep(sessions, agents, since, now) {
  const due = []
  for (const s of sessions) {
    if (s.kind === 'shell') continue
    const a = agents.find((x) => x.name === s.name)
    if (!a || a.agent_status !== 'idle' || a.focused) {
      since.delete(s.name)
      continue
    }
    if (!since.has(s.name)) since.set(s.name, now)
    if (now - since.get(s.name) >= SESSION_IDLE_MS) due.push(s)
  }
  return due
}

// Where a lead lists its Herdr agent sessions, so the SessionEnd sweep closes the idle ones.
export function sessionsFile(home, leadPane) {
  const key = paneKey(leadPane)
  return home && key ? home + '/.agentille/state/lead-' + key + '.sessions' : null
}

// What the lead may do next with the sessions it opened, without any tool of ours.
export function sessionsNote(transport, kind) {
  if (transport === 'herdr' && kind !== 'shell') return sessionsNoteText(SESSION_IDLE_MS / 60_000)
  return SESSIONS_ON_REQUEST
}
