// Pane transport: which multiplexer this session runs in (Herdr, tmux, or none), where a new worker pane goes, which
// panes the reaper is offered, and the resting sessions it closes. The rest lives in leaves by concern, all re-exported
// here so `./panes.js` still carries the whole surface:
//   panes-base.js    names, the pane key, run-dir and lead state files, how a worker is launched
//   panes-tmux.js    tmux list parsing and argv
//   panes-herdr.js   herdr argv and parsers, startup dialogs
//   panes-asks.js    what the person's typed prompt asks a session to run
//   panes-schema.js  the pane tools' definitions and input checks, /agt-spawn arguments
// Pure on purpose — the hooks loader never follows `$` across an import — so every
// $.process / $.env / $.fs call lives in the modules that run them (spawn.js, reaper.js, sessions.js, tools.js)
// and only feeds these helpers. The long text the model reads is in text.js.

import { SESSIONS_ON_REQUEST, sessionsNoteText, PANE_RULE, NO_TRANSPORT } from './text.js'
import { SPAWN_ROLE, SESSION_IDLE_MS } from './panes-base.js'

export { SAFE_RUN, NAME_RE, PROBE, HERDR_START_TIMEOUT, SPAWN_ROLE, DEFAULT_MODEL, SESSION_IDLE_MS, paneName, newRunId, splitName, doneFile, paneKey, answerFile, tabsFile, panesFile, sessionsFile, tabIdsOf, EFFORTS, advisorEnv, workerEnv } from './panes-base.js'
export { TMUX_LIST_FORMAT, parseTmuxList, scopeRows, tmuxPaneAgents, rowIsLead, TMUX_LIST_ARGV, tmuxSplitArgv, tmuxEvenArgv, tmuxTagArgvs, tmuxTitleLockArgv, tmuxPaneIdOf, tmuxKillArgv, tmuxSessionSplitArgv, tmuxTitleArgvs, tmuxTypeArgvs } from './panes-tmux.js'
export { herdrSplitArgv, herdrPaneIdOf, herdrTabArgv, herdrTabOf, herdrTabListArgv, herdrTabIds, startupDialog, trustKeys, dialogKeys, herdrReadArgv, herdrKeysArgv, agentStatusOf, herdrGetArgv, screenLine, codexNote, codexTask, herdrStartArgv, herdrPromptArgv, herdrCloseArgv, herdrMetaArgv, herdrSessionSplitArgv, herdrSessionTabArgv, herdrSessionStartArgv, herdrRunArgv, herdrPaneGetArgv, herdrTerminalOf } from './panes-herdr.js'
export { stripFable, shellCommands, sessionPrompts } from './panes-asks.js'
export { SPAWN_USAGE, parseSpawnArgs, VENDORS, LAYOUTS, TOOL_MODELS, SPAWN_TOOL, CLOSE_TOOL, spawnToolInput, closeTarget, SESSION_KINDS, MAX_SESSIONS, sessionName, OPEN_SESSIONS_TOOL, sessionsToolInput, droppedNote } from './panes-schema.js'

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

// ── reaping ───────────────────────────────────────────────────────────────────

// The panes offered to the reaper: every agt- pane, /agt-spawn ones included, with their real state.
// A spawn pane closes like any worker once it is done/idle and its answer is saved.
export function reapPool(panes) {
  return [...panes]
}

// ── where a worker pane goes ──────────────────────────────────────────────────

// Stacked layout: the first worker splits right of the lead, each later one splits down from the
// newest worker still live. No width probing: a stack always has room for one more row.
export function splitPlan({ lead, opened = [], live = [] }) {
  const alive = opened.filter((o) => live.some((p) => p.id === o.id))
  return alive.length ? { target: alive[alive.length - 1].id, direction: 'down' } : { target: lead, direction: 'right' }
}

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

// ── resting sessions ──────────────────────────────────────────────────────────

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

// What the lead may do next with the sessions it opened, without any tool of ours.
export function sessionsNote(transport, kind) {
  if (transport === 'herdr' && kind !== 'shell') return sessionsNoteText(SESSION_IDLE_MS / 60_000)
  return SESSIONS_ON_REQUEST
}
