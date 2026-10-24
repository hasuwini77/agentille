// Pane names and where their files live: the agt-<run>-<role> name, the run id, the pane key, the run dir's answer
// and done files, the lead's own state files, and how a worker is launched (its agent definition, effort and env).
// agentille-sweep.sh re-implements the key and the file paths (tests/hooks/test-sweep-parity.sh pins the two).
// Pure, like every panes*.js file: no host call, only helpers the modules that run them feed.

import { ROLES } from './routing.js'

export const SAFE_RUN = /^[A-Za-z0-9_-]{1,64}$/
export const NAME_RE = /^[a-z][a-z0-9_-]{0,31}$/
export const ROLE_RE = /^[a-z0-9-]+$/
export const PANE_KEY = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/
// A one-word task: claude would run it as a subcommand.
export const BARE_WORD = /^[a-z-]+$/
export const PROBE = { timeoutMs: 5000 }
export const HERDR_START_TIMEOUT = { timeoutMs: 60000 }
export const TAB_ID = /^[A-Za-z0-9:_-]+$/

export const SPAWN_ROLE = 'spawn'
export const DEFAULT_MODEL = 'sonnet'
// A resting session closes after this long: time to read an answer and type the next prompt.
export const SESSION_IDLE_MS = 10 * 60_000

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

// Where a lead lists its Herdr agent sessions, so the SessionEnd sweep closes the idle ones.
export function sessionsFile(home, leadPane) {
  const key = paneKey(leadPane)
  return home && key ? home + '/.agentille/state/lead-' + key + '.sessions' : null
}

// One tab id per line; anything that is not a tab id is dropped.
export const tabIdsOf = (text) => String(text ?? '').split('\n').map((l) => l.trim()).filter((l) => TAB_ID.test(l))

// ── launching a worker ────────────────────────────────────────────────────────

export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max']
export const effortArgs = (effort) => (EFFORTS.includes(effort) ? ['--effort', effort] : [])
// A routed worker runs as its agentille agent definition (instructions, tools, verdict format),
// not as a bare session that only has the task prompt.
export const agentArgs = (agent) => (ROLES.includes(agent) ? ['--agent', 'agentille:agentille-' + agent] : [])

// Claude Code's advisor attaches to every session from the user's settings. With
// profile.routing.advisorOnOpus false, an Opus or Fable worker runs without one.
export const advisorEnv = (model, settings) => (settings?.advisorOnOpus === false && (model === 'opus' || model === 'fable') ? ['CLAUDE_CODE_DISABLE_ADVISOR_TOOL=1'] : [])

// Who the worker is, for its own mascot band: <agent>:<model>:<effort>. A typed /agt-spawn has no agent.
export const workerEnv = ({ agent, model, effort }) => 'AGENTILLE_WORKER=' + [agent || SPAWN_ROLE, model, EFFORTS.includes(effort) ? effort : ''].join(':')
