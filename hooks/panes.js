// Pane transport: which multiplexer this session runs in (Herdr, tmux, or none), how to
// open a worker pane in it, and how to read tmux panes back as live.js pane agents.
// Pure on purpose — the hooks loader never follows `$` across an import — so every
// $.process / $.env / $.fs call lives in register.js and only feeds these helpers.

import { ROLES, parseHeader } from './routing.js'

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

export const PANE_RULE = 'Pane rule: panes open only on the heavy level (auto-picked or typed `/agt heavy`): each slice\'s executor (and the adversary) via spawn_pane (agent + header); everyone else is a subagent. close_pane right after harvest.'

// The block appended to the /agt skill prompt: which transport is live and, when the mod
// registered the pane tools, the rule for using them.
export function transportBlock(transport, tools = false) {
  const note = transport === 'none' ? 'No pane transport here: parallel slices run as a workflow, else subagent waves.\n' : tools ? PANE_RULE + '\n' : ''
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
export function isLead(rows, selfPane) {
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
  description: 'Open one agentille worker pane beside this session (Herdr or tmux, whichever is live), never focused, named agt-<run>-<role>, running Claude on the model and effort agentille routes for `agent`, with the task as its first prompt. Use it for each heavy-level slice in place of raw herdr/tmux commands. The pane closes itself once it is done and its answer is saved; close it yourself with close_pane right after harvesting.',
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
  description: 'Close one agentille worker pane this session opened (an agt-<run>-<role> pane in this tab or window) after you have read its result. Panes opened by a typed /agt-spawn (the reaper closes those) and panes of other sessions are refused.',
  inputSchema: {
    type: 'object',
    properties: { name: { type: 'string', description: 'The pane name, agt-<run>-<role>.' } },
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
