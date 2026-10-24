// agentille sessions: the person's own Herdr or tmux panes opened through open_sessions. No worker env, no
// agt- name, no wire; a lead lists its Herdr ones so the SessionEnd sweep can close the idle ones.

import { S, Profile } from './state.js'
import { makeStore } from './store.js'
import { PROBE, tmuxEvenArgv, tmuxPaneIdOf, tmuxKillArgv, herdrPaneIdOf, herdrTabOf, herdrPromptArgv, herdrCloseArgv, herdrMetaArgv, herdrSessionSplitArgv, herdrSessionTabArgv, herdrSessionStartArgv, herdrRunArgv, herdrPaneGetArgv, herdrTerminalOf, tmuxSessionSplitArgv, tmuxTitleArgvs, tmuxTypeArgvs, sessionsFile } from './panes.js'
import { runOk, startAgent } from './spawn.js'
import { restingSince } from './panerec.js'

// The person's sessions this lead opened: { id, name, kind, tab, terminal }, oldest first. Read through the Sessions
// view; written only here.
const { s: my, view } = makeStore('sessions.js', {
  sessions: [],
})
export const Sessions = view

// open_sessions opened one.
export function addSession(s) {
  my.sessions.push(s)
}

// The Herdr agent sessions this lead has open, one name per line, where the SessionEnd sweep reads them. A failed
// write loses only the sweep's reach, so it never blocks.
// With none left the old list stays: its names match no agent, and SessionEnd removes the file.
export async function saveSessions($) {
  const file = sessionsFile(Profile.home, await $.env.get('HERDR_PANE_ID'))
  if (file && my.sessions.length) await $.fs.write(file, my.sessions.filter((s) => s.kind !== 'shell' && s.terminal).map((s) => s.name + '\n').join('')).catch(() => {})
}

// Close one session this lead opened → 'closed' | 'gone' | 'failed'. herdr can hand a closed pane's id out again,
// so a herdr pane closes only while it still holds the session's terminal; tmux pane ids never repeat.
export async function closeSession($, t, s) {
  if (t === 'herdr') {
    const g = await $.process.run(herdrPaneGetArgv(s.id), PROBE).catch(() => null)
    if (g?.exitCode !== 0 || !s.terminal || herdrTerminalOf(g.stdout) !== s.terminal) {
      await forgetSession($, s)
      return 'gone'
    }
  }
  const r = await $.process.run(t === 'herdr' ? herdrCloseArgv(s.id) : tmuxKillArgv(s.id), PROBE).catch(() => null)
  if (t === 'herdr' && r?.exitCode !== 0) return 'failed'
  await forgetSession($, s)
  return r?.exitCode === 0 ? 'closed' : 'gone'
}

export async function forgetSession($, s) {
  my.sessions = my.sessions.filter((x) => x !== s)
  restingSince.delete(s.name)
  if (s.terminal) await saveSessions($)
}

// One session pane the person asked for, never focused: below `o.after` (the session before it), else right of
// the lead, or in a new herdr tab. A split under a session that has since closed falls back to the lead. A
// half-made pane is closed again before the error goes up. Returns the session record.
export async function openSession($, t, o) {
  const lead = t === 'tmux' ? await $.env.get('TMUX_PANE') : await $.env.get('HERDR_PANE_ID')
  if (!lead) throw new Error((t === 'tmux' ? 'TMUX_PANE' : 'HERDR_PANE_ID') + ' is not set')
  const at = o.after ? { target: o.after.id, direction: 'down' } : { target: lead, direction: 'right' }
  const failed = (r, argv) => new Error(argv.slice(0, 3).join(' ') + ' exited ' + r.exitCode + (r.stderr ? ': ' + String(r.stderr).trim().slice(0, 120) : ''))
  if (t === 'tmux') {
    const shell = (await $.env.get('SHELL')) ?? ''
    const argv = (p) => tmuxSessionSplitArgv({ ...o, ...p, shell })
    let where = at
    let r = await $.process.run(argv(where), PROBE)
    if (r.exitCode !== 0 && where.target !== lead) r = await $.process.run(argv((where = { target: lead, direction: 'right' })), PROBE)
    if (r.exitCode !== 0) throw failed(r, argv(where))
    const id = tmuxPaneIdOf(r.stdout)
    if (!id) throw new Error('tmux gave no pane id')
    if (o.kind === 'shell' && o.task) {
      try {
        for (const a of tmuxTypeArgvs(id, o.task)) await runOk($, a, PROBE)
      } catch (err) {
        await $.process.run(tmuxKillArgv(id), PROBE).catch(() => {})
        throw err
      }
    }
    // The title and an even stack are cosmetic: a failure never loses the session.
    for (const a of tmuxTitleArgvs(id, o.name)) await $.process.run(a, PROBE).catch(() => {})
    if (where.target !== lead) await $.process.run(tmuxEvenArgv(id), PROBE).catch(() => {})
    return { id, name: o.name, kind: o.kind, tab: null, terminal: null }
  }
  let id
  let terminal
  let tab = o.after?.tab ?? null
  if (o.newTab) {
    const workspace = S.selfWorkspace ?? (await $.env.get('HERDR_WORKSPACE_ID'))
    if (!workspace) throw new Error('HERDR_WORKSPACE_ID is not set')
    const r = await runOk($, herdrSessionTabArgv({ workspace, cwd: o.cwd, label: 'sessions' }), PROBE)
    const made = herdrTabOf(r.stdout)
    if (!made) throw new Error('herdr gave no tab id')
    id = made.pane
    tab = made.tab
    terminal = herdrTerminalOf(r.stdout)
  } else {
    const argv = (p) => herdrSessionSplitArgv({ pane: p.target, cwd: o.cwd, direction: p.direction })
    let where = at
    let r = await $.process.run(argv(where), PROBE)
    if (r.exitCode !== 0 && where.target !== lead) {
      r = await $.process.run(argv((where = { target: lead, direction: 'right' })), PROBE)
      tab = null
    }
    if (r.exitCode !== 0) throw failed(r, argv(where))
    id = herdrPaneIdOf(r.stdout)
    if (!id) throw new Error('herdr gave no pane id')
    terminal = herdrTerminalOf(r.stdout)
  }
  try {
    if (o.kind !== 'shell') {
      await startAgent($, herdrSessionStartArgv({ name: o.name, pane: id, kind: o.kind, model: o.model }), o.name, o.cwd)
      if (o.task) await runOk($, herdrPromptArgv(o.name, o.task), PROBE)
    } else if (o.task) {
      await runOk($, herdrRunArgv(id, o.task), PROBE)
    }
  } catch (err) {
    await $.process.run(herdrCloseArgv(id), PROBE).catch(() => {})
    throw err
  }
  const meta = herdrMetaArgv(id, { display: '◆ ' + o.name + ' · ' + (o.model ?? o.kind) })
  if (meta) await $.process.run(meta, PROBE).catch(() => {})
  return { id, name: o.name, kind: o.kind, tab, terminal }
}
