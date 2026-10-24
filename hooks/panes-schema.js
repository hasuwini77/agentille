// The pane tools' input: the spawn_pane, close_pane and open_sessions definitions the mod registers, the checks that
// turn their input into what tools.js acts on, and the typed /agt-spawn arguments. Pure.

import { ROLES, parseHeader } from './routing.js'
import { SPAWN_TOOL_TEXT, CLOSE_TOOL_TEXT, sessionsToolText } from './text.js'
import { SAFE_RUN, NAME_RE, ROLE_RE, BARE_WORD, SPAWN_ROLE, DEFAULT_MODEL, SESSION_IDLE_MS, paneName, splitName } from './panes-base.js'
import { shellCommands, sessionPrompts, stripFable, normTask } from './panes-asks.js'

const MODEL_LIKE = /^[A-Za-z0-9][\w.-]*$/
const MODEL_RE = /^(haiku|sonnet|opus|fable|claude-[a-z0-9.-]+)$/

export const SPAWN_USAGE = 'Usage: /agt-spawn "task" [--model sonnet|opus|haiku|fable]'

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

export const VENDORS = ['claude', 'codex']
export const LAYOUTS = ['stack', 'tab']

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
