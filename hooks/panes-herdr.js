// herdr: the argv that open a worker pane or run tab, start and prompt its agent, clear a startup dialog, label and
// close it, and the parsers for what herdr prints back. Pure: the modules that run these make the calls.

import { TAB_ID, agentArgs, effortArgs, workerEnv } from './panes-base.js'

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

// ── sessions: a plain split or tab, none of a worker's env ────────────────────

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
