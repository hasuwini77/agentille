// tmux: reading `tmux list-panes` back as live.js pane agents, and the argv that open, tag, title and close a
// worker or session pane. Pure: the modules that run these (spawn.js, reaper.js, sessions.js, tools.js) make the calls.

import { splitName, agentArgs, effortArgs, workerEnv } from './panes-base.js'

const TAB = '\t'

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

export function tmuxSplitArgv({ target, cwd, run, shell, model, name, task, effort, direction, agent, env = [] }) {
  const head = ['tmux', 'split-window', '-d', direction === 'down' ? '-v' : '-h', '-P', '-F', '#{pane_id}', '-t', target, '-c', cwd.replace(/#/g, '##'), '-e', 'AGENTILLE_RUN=' + run, '-e', workerEnv({ agent, model, effort }), ...env.flatMap((v) => ['-e', v])]
  // `--` ends claude's options, so a task that starts with `-` is still just the prompt
  const tail = [...agentArgs(agent), '--model', model, ...effortArgs(effort), '-n', name, '--', task]
  const base = String(shell ?? '').split('/').pop()
  if (base === 'zsh' || base === 'bash') return [...head, shell, '-ic', 'claude "$@"', 'agt', ...tail]
  return [...head, 'claude', ...tail]
}

export const tmuxEvenArgv = (id) => ['tmux', 'select-layout', '-E', '-t', id]

export function tmuxTagArgvs(id, name) {
  return [
    ['tmux', 'set-option', '-p', '-t', id, '@agt', name],
    ['tmux', 'set-option', '-p', '-t', id, '@agt_vendor', 'claude'],
    ['tmux', 'select-pane', '-t', id, '-T', name],
  ]
}

// Keeps the worker from renaming its own pane (the lead reads panes by title). The pane option exists from tmux 3.3;
// on an older tmux the call fails and the pane still opens, titled, so it is run best-effort, apart from the tags.
export const tmuxTitleLockArgv = (id) => ['tmux', 'set-option', '-p', '-t', id, 'allow-set-title', 'off']

export function tmuxPaneIdOf(stdout) {
  const id = String(stdout ?? '').trim()
  return /^%\d+$/.test(id) ? id : null
}

export const tmuxKillArgv = (id) => ['tmux', 'kill-pane', '-t', id]

// ── sessions: a plain split, none of a worker's env ───────────────────────────

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
  tmuxTitleLockArgv(id),
  ['tmux', 'select-pane', '-t', id, '-T', name],
]
export const tmuxTypeArgvs = (id, command) => [['tmux', 'send-keys', '-t', id, '-l', '--', command], ['tmux', 'send-keys', '-t', id, 'Enter']]
