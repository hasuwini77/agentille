// agentille worker panes: the pane transport (Herdr, tmux or none), opening one routed claude pane beside the
// lead (split or run tab), the startup dialogs it clears, the run tabs a lead records, and the pane tools'
// registration on the typed prompt that unlocks them.

import { isLead, Session } from './session.js'
import { Profile } from './profile.js'
import { makeStore } from './store.js'
import { PROBE, HERDR_START_TIMEOUT, pickTransport, splitName, paneKey, answerFile, advisorEnv, tmuxSplitArgv, tmuxEvenArgv, tmuxTagArgvs, tmuxTitleLockArgv, tmuxPaneIdOf, tmuxKillArgv, herdrSplitArgv, herdrPaneIdOf, herdrTabArgv, herdrTabOf, herdrTabListArgv, herdrTabIds, tabsFile, panesFile, startupDialog, dialogKeys, herdrReadArgv, herdrKeysArgv, agentStatusOf, herdrGetArgv, screenLine, codexTask, herdrStartArgv, herdrPromptArgv, herdrCloseArgv, herdrMetaArgv, SPAWN_TOOL, CLOSE_TOOL, OPEN_SESSIONS_TOOL } from './panes.js'
import { wireEnv, shortName } from './wire.js'
import { tmuxInit } from './tmux-env.js'
import { sameConfig } from './trust.js'
export { sameConfig, commandPaths } from './trust.js'

// The pane transport's store: the transport probed for this session, every pane name this lead opened, the run tabs
// it made and which pane tools are registered. Read through the Spawn view; written only here.
const { s: my, view } = makeStore('spawn.js', {
  transport: null,  // 'herdr' | 'tmux' | 'none', probed once at session start
  openedNames: new Set(),  // every pane name this lead opened, kept after the pane closes
  ownedTabs: new Set(),  // herdr: run tabs this session created; its panes are reaped, closed and swept like the lead's tab's
  paneTools: false,  // spawn_pane (and close_pane) registered: a typed /agt arrived in this lead session
  sessionTools: false,  // open_sessions (and close_pane) registered: a typed ask for sessions arrived
  closeTool: false,  // close_pane registered, by whichever of the two came first
  trustUnresolvedTold: false,  // the once-per-session note that a worktree's config runs a command the mod cannot follow
})
export const Spawn = view

// Session start: probe the transport afresh.
export async function probeTransport($) {
  my.transport = await detectTransport($)
  return my.transport
}

// A pane this lead opened (spawn_pane, /agt-spawn): it is the lead's to reap, close and sweep from now on.
export function ownName(name) {
  my.openedNames.add(name)
}

export async function probeOk($, argv) {
  try {
    return (await $.process.run(argv, tmuxInit(argv, PROBE))).exitCode === 0
  } catch {
    return false
  }
}

// herdr → tmux → none. A probe that rejects or exits non-zero counts as unavailable; so
// does a host with no $.process (desktop app, VS Code), where the call itself throws.
export async function detectTransport($) {
  const herdrOk = (await $.env.get('HERDR_ENV')) === '1' && (await probeOk($, ['herdr', '--version']))
  const tmuxOk = !herdrOk && ((await $.env.get('TMUX')) ?? '') !== '' && (await probeOk($, ['tmux', '-V']))
  return pickTransport({ herdrOk, tmuxOk })
}

export async function transportOf($) {
  my.transport ??= await detectTransport($)
  return my.transport
}

// The run tabs this lead made, one id per line where the SessionEnd sweep reads them. A failed write loses
// only the sweep's reach, so it never blocks.
export async function saveTabs($) {
  const file = tabsFile(Profile.home, await $.env.get('HERDR_PANE_ID'))
  if (file) await $.fs.write(file, [...my.ownedTabs].map((t) => t + '\n').join('')).catch(() => {})
}

// The lead's pane id in this transport: where its tabs, panes and sessions files are keyed.
export async function leadPane($) {
  return (await transportOf($)) === 'tmux' ? await $.env.get('TMUX_PANE') : await $.env.get('HERDR_PANE_ID')
}

// The worker panes this lead opened, one name per line, where the SessionEnd sweep reads them. Ownership is by
// name (agt-<run>-<role>, the run id is random), so a restarted lead takes its own panes back and no other.
export async function savePanes($) {
  const file = panesFile(Profile.home, await leadPane($))
  if (file) await $.fs.write(file, [...my.openedNames].map((n) => n + '\n').join('')).catch(() => {})
}

export async function loadOwned($) {
  const file = panesFile(Profile.home, await leadPane($))
  if (!file) return
  const text = await $.fs.read(file).catch(() => '')
  for (const n of String(text ?? '').split('\n')) if (splitName(n)) my.openedNames.add(n)
}

// A run tab herdr no longer lists is gone (its last pane closed): forget it.
export async function pruneTabs($, workspace) {
  if (!my.ownedTabs.size || !workspace) return
  const r = await $.process.run(herdrTabListArgv(workspace), PROBE).catch(() => null)
  const ids = r?.exitCode === 0 ? herdrTabIds(r.stdout) : null
  if (!ids) return
  const gone = [...my.ownedTabs].filter((t) => !ids.includes(t))
  for (const t of gone) my.ownedTabs.delete(t)
  if (gone.length) await saveTabs($)
}

// The lead's cwd and a pane's cwd are the same repo when they share a git common dir (a worktree does).
export async function sameCheckout($, a, b) {
  if (a === b) return true
  const dir = async (d) => {
    const r = await $.process.run(['git', '-C', d, 'rev-parse', '--path-format=absolute', '--git-common-dir'], PROBE).catch(() => null)
    return r?.exitCode === 0 ? String(r.stdout).trim() : ''
  }
  const [x, y] = await Promise.all([dir(a), dir(b)])
  return !!x && x === y
}

// Whether the mod may accept the folder-trust prompt for `cwd` on the person's behalf. Sharing the lead's git
// common dir is not enough: a worktree of a contributor's branch can carry its own hooks, MCP servers, agents and
// commands, and a folder inside a checkout (a gitignored node_modules/<pkg>) can carry a .claude/ or .mcp.json of
// its own. Trusted: the lead's own cwd, the root of the lead's checkout, or the root of a worktree of the same repo
// on an agt/* branch that this lead's runs made, named by its exact path on the lead-<pane>.worktrees list (guard.js:
// JSON records with path and branch; a plain one-per-line list is read too; a branch name alone is not ownership),
// whose project config matches the lead checkout's (sameConfig). A folder below either root is never accepted. With
// no list nothing but the lead's own cwd and checkout root is accepted.
const OWN_BRANCH = /^agt\/[A-Za-z0-9._/-]+$/
// The worktree paths a lead-<pane>.worktrees file names: the `path` of each JSON record (guard.js), or the absolute
// paths on a plain one-per-line list. Branch names are skipped: a branch can be checked out anywhere.
export function listedPaths(listed) {
  try {
    const recs = JSON.parse(listed)
    if (Array.isArray(recs)) return recs.filter((r) => r && typeof r.path === 'string' && r.path.startsWith('/')).map((r) => r.path)
  } catch {}
  return String(listed).split('\n').flatMap((l) => l.trim().split(/\s+/).filter((f) => f.startsWith('/')))
}
// Does the list name this worktree root `top` (as git prints it) by its exact path.
export function ownedWorktree(listed, top) {
  return listedPaths(listed).some((p) => p.replace(/\/+$/, '') === top)
}

// git's answer, trimmed, or null when git failed: '' is a real answer (--show-prefix at a checkout's root).
async function gitOutOrNull($, d, ...a) {
  const r = await $.process.run(['git', '-C', d, ...a], PROBE).catch(() => null)
  return r?.exitCode === 0 ? String(r.stdout ?? '').trim() : null
}
// A listed path that is not `top` letter for letter may still be it through a symlink (/tmp and /private/tmp): git
// resolves it. Only paths with top's own last segment are asked, so a long list costs nothing.
async function listsRoot($, listed, top) {
  if (ownedWorktree(listed, top)) return true
  const leaf = top.split('/').pop()
  for (const p of listedPaths(listed).filter((x) => x.replace(/\/+$/, '').split('/').pop() === leaf).slice(0, 8)) {
    const [real, prefix] = await Promise.all([gitOutOrNull($, p, 'rev-parse', '--show-toplevel'), gitOutOrNull($, p, 'rev-parse', '--show-prefix')])
    if (real === top && prefix === '') return true
  }
  return false
}

export async function trustable($, cwd, leadCwd, why = {}) {
  if (cwd === leadCwd) return true
  if (!(await sameCheckout($, cwd, leadCwd))) return false
  const [top, leadTop, prefix] = await Promise.all([gitOutOrNull($, cwd, 'rev-parse', '--show-toplevel'), gitOutOrNull($, leadCwd, 'rev-parse', '--show-toplevel'), gitOutOrNull($, cwd, 'rev-parse', '--show-prefix')])
  // A folder below a checkout's root brings whatever .claude/ or .mcp.json sits in it: never on the person's behalf.
  if (!top || !leadTop || prefix !== '') return false
  if (top === leadTop) return true
  const branch = await gitOutOrNull($, cwd, 'symbolic-ref', '--short', 'HEAD')
  if (!branch || !OWN_BRANCH.test(branch)) return false
  const file = String(panesFile(Profile.home, await leadPane($)) ?? '').replace(/\.panes$/, '.worktrees')
  const listed = file ? await $.fs.read(file).catch(() => null) : null
  if (typeof listed !== 'string' || !(await listsRoot($, listed, top))) return false
  return sameConfig($, top, leadTop, why)
}

// Once per session: a worktree whose config runs a command the mod cannot follow to files (an npx package no lockfile
// pins, a script that reads another package folder) is never trusted for the person. One toast says so and names it.
function unresolvedOnce($, cwd, what) {
  if (my.trustUnresolvedTold) return
  my.trustUnresolvedTold = true
  Promise.resolve($.ui.toast('agt ⚑ ' + cwd + ': ' + what[0] + ' could not be followed to files, so the folder is not trusted for you; open it once by hand to trust it')).catch(() => {})
}

// A fresh worker stopped on a startup screen (agent_not_ready): classify it, press the keys that clear it, up to
// 3 times. A trust prompt is accepted only where trustable says so; anything else throws and the pane is closed.
export async function clearDialogs($, name, cwd) {
  for (let i = 0; i < 3; i++) {
    const read = await $.process.run(herdrReadArgv(name), PROBE)
    const screen = String(read.stdout ?? '')
    const kind = startupDialog(screen)
    if (!kind) throw new Error(screenLine(screen))
    if (kind === 'trust') {
      const why = {}
      if (!(await trustable($, cwd, await $.session.cwd(), why))) {
        if (why.unresolved?.length) unresolvedOnce($, cwd, why.unresolved)
        throw new Error(cwd + ' needs a one-time trust: open it once by hand.' + (why.unresolved?.length ? ' The mod could not follow ' + why.unresolved[0] + ' to files.' : ''))
      }
    }
    const keys = dialogKeys(kind, screen)
    if (!keys.length) throw new Error(screenLine(screen))
    // One key at a time: a menu that has only just drawn drops keys sent in one burst.
    for (const k of keys) {
      await $.clock.sleep(300)
      await runOk($, herdrKeysArgv(name, [k]), PROBE)
    }
    // herdr reads the cleared screen about 0.5 s later; poll up to 10 s, then look for a next dialog.
    for (let n = 0; n < 20; n++) {
      await $.clock.sleep(500)
      const g = await $.process.run(herdrGetArgv(name), PROBE).catch(() => null)
      const status = g?.exitCode === 0 ? agentStatusOf(g.stdout) : null
      if (status === 'idle' || status === 'done') return
      if (status === 'blocked' && n >= 3) break
    }
  }
  throw new Error('startup dialogs did not clear after 3 tries')
}

// One tmux call with the probe timeout and the UTF-8 locale (tmux-env.js); the result as $.process.run gives it.
export function runTmux($, argv) {
  return $.process.run(argv, tmuxInit(argv, PROBE))
}

export async function runOk($, argv, init) {
  const r = await $.process.run(argv, tmuxInit(argv, init))
  if (r.exitCode !== 0) throw new Error(argv.slice(0, 3).join(' ') + ' exited ' + r.exitCode + (r.stderr ? ': ' + String(r.stderr).trim().slice(0, 120) : ''))
  return r
}

// A fresh pane is busy while its shell starts up (a login banner, a slow rc): herdr says
// agent_pane_busy, so wait and try again for up to ~10s. A startup dialog is cleared.
export async function startAgent($, argv, name, cwd) {
  for (let attempt = 0; ; attempt++) {
    const r = await $.process.run(argv, HERDR_START_TIMEOUT)
    if (r.exitCode === 0) return
    if (/agent_not_ready/.test(r.stderr ?? '')) return clearDialogs($, name, cwd)
    if (!/agent_pane_busy/.test(r.stderr ?? '') || attempt >= 20) throw new Error('herdr agent start exited ' + r.exitCode + (r.stderr ? ': ' + String(r.stderr).trim().slice(0, 120) : ''))
    await $.clock.sleep(500)
  }
}

// One claude pane beside this one, named agt-<run>-<role>, never focused. A half-made
// pane is closed again before the error goes up. `split` stacks it beside an earlier worker
// instead of the lead; `newTab` opens a herdr run tab. Returns { id, tab }.
export async function openPane($, t, o) {
  if (t === 'tmux') {
    const lead = await $.env.get('TMUX_PANE')
    if (!lead) throw new Error('TMUX_PANE is not set')
    const target = o.split?.target ?? lead
    const shell = (await $.env.get('SHELL')) ?? ''
    const id = tmuxPaneIdOf((await runOk($, tmuxSplitArgv({ ...o, target, shell, direction: o.split?.direction, env: [...wireEnv({ name: o.name, lead: Session.sessionId }), ...advisorEnv(o.model, Profile.settings)] }), PROBE)).stdout)
    if (!id) throw new Error('tmux gave no pane id')
    try {
      for (const argv of tmuxTagArgvs(id, o.name)) await runOk($, argv, PROBE)
      await runTmux($, tmuxTitleLockArgv(id)).catch(() => {})  // tmux < 3.3 has no allow-set-title; the pane still opens
    } catch (err) {
      await runTmux($, tmuxKillArgv(id)).catch(() => {})
      throw err
    }
    // Even out the stack; a cosmetic failure never loses the worker.
    if (o.split && o.split.target !== lead) await runTmux($, tmuxEvenArgv(id)).catch(() => {})
    return { id, tab: null }
  }
  const lead = await $.env.get('HERDR_PANE_ID')
  if (!lead) throw new Error('HERDR_PANE_ID is not set')
  const env = [...wireEnv({ name: o.name, lead: Session.sessionId }), ...advisorEnv(o.model, Profile.settings)]
  let id
  let tab = o.split?.tab ?? null
  if (o.newTab) {
    const workspace = Session.selfWorkspace ?? (await $.env.get('HERDR_WORKSPACE_ID'))
    if (!workspace) throw new Error('HERDR_WORKSPACE_ID is not set')
    const made = herdrTabOf((await runOk($, herdrTabArgv({ workspace, cwd: o.cwd, run: o.run, agent: o.agent, model: o.model, effort: o.effort, env }), PROBE)).stdout)
    if (!made) throw new Error('herdr gave no tab id')
    id = made.pane
    tab = made.tab
    my.ownedTabs.add(tab)
    await saveTabs($)
  } else {
    const pane = o.split?.target ?? lead
    id = herdrPaneIdOf((await runOk($, herdrSplitArgv({ pane, cwd: o.cwd, run: o.run, direction: o.split?.direction, agent: o.agent, model: o.model, effort: o.effort, env }), PROBE)).stdout)
    if (!id) throw new Error('herdr gave no pane id')
  }
  try {
    await startAgent($, herdrStartArgv({ name: o.name, pane: id, model: o.model, effort: o.effort, agent: o.agent, vendor: o.vendor }), o.name, o.cwd)
    // Codex has no pane tools of ours: it saves its answer where the harvest, reaper and wake paths look.
    const task = o.vendor === 'codex' ? codexTask(o.task, answerFile(Profile.home, o.run, splitName(o.name).role, paneKey(id))) : o.task
    await runOk($, herdrPromptArgv(o.name, task), PROBE)
  } catch (err) {
    await $.process.run(herdrCloseArgv(id), PROBE).catch(() => {})
    if (o.newTab) {
      my.ownedTabs.delete(tab) // a run tab's only pane closing takes the tab with it
      await saveTabs($)
    }
    throw err
  }
  // Herdr's sidebar names the worker by role and route; cosmetic, so a failure is ignored.
  const meta = herdrMetaArgv(id, { display: '▣ ' + shortName(o.name) + ' · ' + o.model })
  if (meta) await $.process.run(meta, PROBE).catch(() => {})
  return { id, tab }
}

// The pane tools exist only once the person typed for them, so a plain session carries no spawn_pane or
// open_sessions in its tool list: a typed /agt registers spawn_pane, a typed ask for sessions registers
// open_sessions, and close_pane comes with whichever came first. A worker pane gets no fan-out of its own,
// and a host without a pane transport gets none. A tool registered while a prompt is submitted is in that
// turn's list.
export async function ensureTools($, which) {
  if (!isLead() || Session.hostOld) return
  if ((which === 'panes' ? my.paneTools : my.sessionTools) || (await transportOf($)) === 'none') return
  try {
    await $.tool.register(which === 'panes' ? SPAWN_TOOL : OPEN_SESSIONS_TOOL)
    if (!my.closeTool) {
      await $.tool.register(CLOSE_TOOL)
      my.closeTool = true
    }
    if (which === 'panes') my.paneTools = true
    else my.sessionTools = true
  } catch {
    // an older host without $.tool.register: /agt runs its heavy level as subagent waves
  }
}
