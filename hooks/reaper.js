// agentille reaper: what the lead sees of its panes (herdr or tmux poll), which finished worker is harvested,
// which closes, which is flagged, the wake it sends itself, and the cleaner behind /agt-clean.

import { S } from './state.js'
import { herdrOrphans, tmuxOrphans, orphanPlan, staleTabs, parseWorktrees, worktreePlan, cleanText, FRESH_MS } from './clean.js'
import { ownedWorktrees, forgetOwned } from './guard.js'
import { writeRunFile } from './dispatch.js'
import { paneAgents, reapPlan, ledger, panesLeft, endRoute } from './live.js'
import { SAFE_RUN, PROBE, SPAWN_ROLE, splitName, doneFile, paneKey, answerFile, parseTmuxList, scopeRows, isFreshDone, quietSpawn, tmuxPaneAgents, isLead, TMUX_LIST_ARGV, reapPool, tmuxKillArgv, herdrCloseArgv, herdrPaneGetArgv, herdrTerminalOf, SESSION_IDLE_MS, sessionSweep } from './panes.js'
import { closeSession, forgetSession } from './sessions.js'
import { pruneTabs } from './spawn.js'
import { wakeDue, wakeMessage } from './wire.js'
import * as P from './panerec.js'
const { runs, live, paneRoutes, openedNames } = S
const { restingSince, staged, strandedNow } = P

// Panes that left the stage this poll: end their route and refresh the ledger.
export async function notePaneExits($) {
  const touched = new Set()
  for (const name of panesLeft(staged, S.panes)) {
    const r = endRoute(paneRoutes, name, Date.now())
    if (r) touched.add(r.run)
  }
  for (const run of touched) await writeRunFile($, run, 'ledger.json', JSON.stringify(ledger(live, run, paneRoutes), null, 2) + '\n')
}

// A file counts only if it was written once this session knew the pane: a role can be respawned, and
// the earlier pane's answer is not this worker's.
export async function freshAnswer($, file, p) {
  if (!file) return false
  try {
    return isFreshDone(await $.fs.stat(file), P.get(p.id)?.firstSeen)
  } catch {
    return false // missing or unreadable
  }
}

// Where a pane worker saved its full answer, or null. Each pane instance writes its own file
// (pane-<role>.<pane>.md). An older worker's legacy pane-<role>.md counts only while one pane has the
// name: with two, it could be either one's.
export async function answerOf($, p) {
  const n = splitName(p.name)
  if (!n) return null
  const own = answerFile(S.home, n.run, n.role, paneKey(p.id))
  if (await freshAnswer($, own, p)) return own
  // Known limit: two keyless twins (an older worker's one legacy file) cannot be told apart, so with two panes of the
  // name neither is harvested by it and both stay flagged.
  if (S.panes.filter((q) => q.name === p.name).length !== 1) return null
  const legacy = answerFile(S.home, n.run, n.role)
  return (await freshAnswer($, legacy, p)) ? legacy : null
}

export async function isHarvested($, p) {
  if (P.get(p.id)?.harvested) return true
  if (!(await answerOf($, p))) return false
  P.rec(p.id).harvested = true
  return true
}

// A pane finished and no wire done message came: the lead's own session gets one message naming
// the pane and how to read it, so the lead does not wait blind. Once per pane. A blocked pane waits on the person.
export async function wakeLead($, pool, now, t) {
  if (!S.sessionId) return
  for (const p of wakeDue(pool.filter((q) => q.role !== SPAWN_ROLE), P.seen, P.wireDone, P.woken, now)) { // a spawn pane has no lead run to wake
    P.rec(p.id).woken = true
    const text = wakeMessage({ name: p.name, transport: t, id: p.id, answerPath: await answerOf($, p) })
    const r = await $.session.send({ to: { sessionId: S.sessionId }, text }).catch((err) => ({ isDelivered: false, reason: String(err?.message ?? err) }))
    if (!r.isDelivered) $.ui.toast('agt ⚑ ' + p.name + ' ' + p.state + ' with no report. ' + text.slice(text.indexOf('. ') + 2).slice(0, 120))
  }
}

// The lead's reaper. A finished pane closes only once its answer is in hand; until then it stays
// open and is flagged once, so a worker that could not report never loses its output.
export async function sweep($, pool, now, t, close) {
  const ok = new Set()
  for (const p of pool) if ((p.state === 'done' || p.state === 'idle') && (await isHarvested($, p))) ok.add(p.id)
  const plan = reapPlan(pool, P.seen, now, S.leadTurn, (p) => ok.has(p.id))
  strandedNow.clear()
  for (const p of plan.stranded) {
    strandedNow.add(p.name)
    if (P.get(p.id)?.strandedToasted) continue
    P.rec(p.id).strandedToasted = true
    $.ui.toast('agt ⚑ ' + p.name + ' ' + p.state + ', not harvested')
  }
  for (const p of plan.reap) {
    try {
      await close(p)
      $.ui.toast('agt reaped ' + p.name + ' (' + p.state + ')')
    } catch {
      // a pane closed by hand in the meantime is fine
    }
  }
  await wakeLead($, pool, now, t)
}

export async function pollHerdr($) {
  let list = []
  try {
    const r = await $.process.run(['herdr', 'agent', 'list'], PROBE)
    list = JSON.parse(r.stdout).result?.agents ?? []
  } catch {
    return
  }
  const selfPane = (await $.env.get('HERDR_PANE_ID')) ?? null
  const me = list.find((p) => p.pane_id === selfPane)
  S.selfName = me && typeof me.name === 'string' && me.name.startsWith('agt-') ? me.name : null
  S.selfTab = me?.tab_id ?? null
  S.selfWorkspace = me?.workspace_id ?? S.selfWorkspace
  // A lead sees, reaps and wakes for the panes it opened (openedNames, by name: the run id is random), never
  // another session's workers in the same tab. Workers (panes that are themselves agt-*) see their siblings and never reap.
  const real = paneAgents(list, selfPane).filter((p) => !me || p.workspace === me.workspace_id)
  const owned = S.selfName ? real : real.filter((p) => openedNames.has(p.name))
  S.panes = quietSpawn(owned) // the band shows a spawn pane as `open`; the reaper below sees its real state
  const now = await $.clock.now()
  for (const p of S.panes) if (P.get(p.id)?.firstSeen === undefined) P.rec(p.id).firstSeen = now
  P.forgetGone(S.panes)
  await notePaneExits($)
  if (me && !S.selfName) {
    await pruneTabs($, me.workspace_id)
    await sweep($, reapPool(owned), now, 'herdr', (p) => $.process.run(herdrCloseArgv(p.id)))
    // A session with no agent listed is a shell or a pane closed by hand: only a gone one is forgotten.
    for (const s of S.sessions.filter((x) => !list.some((a) => a.name === x.name))) {
      const g = await $.process.run(herdrPaneGetArgv(s.id), PROBE).catch(() => null)
      if (g?.exitCode !== 0 || herdrTerminalOf(g.stdout) !== s.terminal) await forgetSession($, s)
    }
    for (const s of sessionSweep(S.sessions, list, restingSince, now)) {
      if ((await closeSession($, 'herdr', s)) === 'closed') $.ui.toast('agt ◆ closed ' + s.name + ': idle ' + SESSION_IDLE_MS / 60_000 + ' min')
    }
  }
  $.ui.invalidate('ui.render')
}

// tmux has no agent status, so a pane is working until its done-file appears or tmux
// calls it dead. Panes are scoped to the lead's own window; only an unnamed lead reaps,
// and tmux has no idle state, so only the 10s done grace applies.
export async function pollTmux($) {
  let rows = []
  try {
    const r = await $.process.run(TMUX_LIST_ARGV, PROBE)
    if (r.exitCode !== 0) return
    rows = parseTmuxList(r.stdout)
  } catch {
    return
  }
  const selfPane = (await $.env.get('TMUX_PANE')) ?? null
  const me = rows.find((r) => r.id === selfPane)
  S.selfName = me && me.agt.startsWith('agt-') ? me.agt : null
  // Window-scope first, then ownership: no file is read for a pane this lead did not open. A done-file counts
  // only if it was written after the pane was first listed.
  const now = await $.clock.now()
  const scoped = me ? scopeRows(rows, selfPane).filter((r) => S.selfName || openedNames.has(r.agt)) : []
  for (const r of scoped) if (P.get(r.id)?.firstSeen === undefined) P.rec(r.id).firstSeen = now
  P.forgetGone(rows)
  const done = new Map()
  for (const r of scoped) {
    const n = splitName(r.agt)
    // A worker writes done-<role>; a /agt-spawn pane has no such instruction, so its saved answer is its done signal.
    const file = n && !r.dead && (n.role === SPAWN_ROLE ? answerFile(S.home, n.run, n.role, paneKey(r.id)) : doneFile(S.home, n.run, n.role))
    if (!file) continue
    try {
      done.set(r.agt, isFreshDone(await $.fs.stat(file), P.get(r.id)?.firstSeen))
    } catch {
      // missing or unreadable counts as not done
    }
  }
  const real = tmuxPaneAgents(rows, selfPane, done).filter((p) => S.selfName || openedNames.has(p.name))
  S.panes = quietSpawn(real)
  await notePaneExits($)
  if (isLead(rows, selfPane)) {
    await sweep($, reapPool(real), now, 'tmux', (p) => $.process.run(tmuxKillArgv(p.id), PROBE))
  }
  $.ui.invalidate('ui.render')
}

export async function pollNow($, t) {
  if (t === 'herdr') await pollHerdr($)
  else if (t === 'tmux') await pollTmux($)
}

// A worker's answer is on disk: its own instance file, the legacy pane-<role>.md, or its done marker. The orphan
// cleaner closes only such panes; a finished pane whose output exists only on its screen stays and is named.
export async function savedAnswer($, name, id) {
  const n = splitName(name)
  if (!n) return false
  for (const f of [answerFile(S.home, n.run, n.role, paneKey(id)), answerFile(S.home, n.run, n.role), doneFile(S.home, n.run, n.role)]) {
    if (f && (await $.fs.exists(f).catch(() => false))) return true
  }
  return false
}

async function withAnswer($, plan) {
  const close = []
  for (const p of plan.close) {
    if (p.state === 'dead' || (await savedAnswer($, p.name, p.id))) close.push(p)
    else plan.keep.push({ what: p.name, why: p.state + ', answer not saved' })
  }
  return close
}

// ── the cleaner ──────────────────────────────────────────────────────────────
// Panes: agt-* panes no live lead owns (their lead died before its SessionEnd sweep) close once
// finished; a typed /agt-clean also closes this lead's stranded panes (done, answer never read). Run-tab files of gone leads are dropped.
// Git (not on `panes` alone): agt/* worktrees this session's runs opened, merged and clean, are removed and
// their merged branches deleted; at a run's end (auto) the .env* copies in them go first.
// Clean means done/idle/dead panes, merged branches and clean checkouts only; the rest is reported, never touched.
export async function cleanWorkspace($, { all = false, auto = false, panesOnly = false } = {}) {
  const r = { closed: [], tabs: 0, removed: [], branches: [], runs: 0, keep: [] }
  const run = (argv) => $.process.run(argv, PROBE).catch(() => null)
  if (S.transport === 'herdr') {
    const res = await run(['herdr', 'agent', 'list'])
    let list = []
    try { list = JSON.parse(res?.stdout ?? '').result?.agents ?? [] } catch { /* herdr down: nothing to judge */ }
    // A lead missing from the list cannot tell a dead lead's tab from its own: judge nothing.
    const self = await $.env.get('HERDR_PANE_ID')
    if (!list.some((a) => a.pane_id === self && !String(a.name ?? '').startsWith('agt-'))) list = []
    const dir = S.home ? S.home + '/.agentille/state' : null
    const keys = dir ? (await $.fs.list(dir).catch(() => [])).map((f) => f.name).filter((n) => /^lead-[\w-]+\.tabs$/.test(n)).map((n) => n.slice(5, -5)) : []
    const tabs = new Map()
    for (const k of keys) tabs.set(k, String(await $.fs.read(dir + '/lead-' + k + '.tabs').catch(() => '')).split('\n').filter(Boolean))
    const plan = orphanPlan(herdrOrphans(list, (id) => tabs.get(paneKey(id))))
    const close = [...(await withAnswer($, plan)), ...(all ? S.panes.filter((p) => strandedNow.has(p.name) && !plan.close.some((c) => c.id === p.id)) : [])]
    for (const p of close) if ((await run(herdrCloseArgv(p.id)))?.exitCode === 0) r.closed.push(p.name)
    r.keep.push(...plan.keep)
    for (const k of staleTabs(keys, list, paneKey)) if ((await run(['rm', '-f', dir + '/lead-' + k + '.tabs']))?.exitCode === 0) r.tabs += 1
    // A dead lead's pane list goes with its tabs file; its panes are judged by the orphan rule above.
    const paneKeys = dir ? (await $.fs.list(dir).catch(() => [])).map((f) => f.name).filter((n) => /^lead-[\w-]+\.panes$/.test(n)).map((n) => n.slice(5, -6)) : []
    for (const k of staleTabs(paneKeys, list, paneKey)) await run(['rm', '-f', dir + '/lead-' + k + '.panes'])
    // A lead that died skipped its SessionEnd sweep: close its idle sessions, then drop its list.
    const sessKeys = dir ? (await $.fs.list(dir).catch(() => [])).map((f) => f.name).filter((n) => /^lead-[\w-]+\.sessions$/.test(n)).map((n) => n.slice(5, -9)) : []
    for (const k of staleTabs(sessKeys, list, paneKey)) {
      const names = String(await $.fs.read(dir + '/lead-' + k + '.sessions').catch(() => '')).split('\n').filter((n) => /^s-[\w-]+$/.test(n))
      for (const a of list) if (names.includes(a.name) && a.agent_status === 'idle' && !a.focused && (await run(herdrCloseArgv(a.pane_id)))?.exitCode === 0) r.closed.push(a.name)
      await run(['rm', '-f', dir + '/lead-' + k + '.sessions'])
    }
  } else if (S.transport === 'tmux') {
    const res = await run(TMUX_LIST_ARGV)
    let rows = res?.exitCode === 0 ? parseTmuxList(res.stdout) : []
    if (!isLead(rows, await $.env.get('TMUX_PANE'))) rows = []
    const done = new Set()
    for (const row of rows) {
      const n = splitName(row.agt)
      const file = n && doneFile(S.home, n.run, n.role)
      if (file && (await $.fs.exists(file).catch(() => false))) done.add(row.id)
    }
    const plan = orphanPlan(tmuxOrphans(rows, (row) => done.has(row.id)))
    const close = [...(await withAnswer($, plan)), ...(all ? S.panes.filter((p) => strandedNow.has(p.name) && !plan.close.some((c) => c.id === p.id)) : [])]
    for (const p of close) if ((await run(tmuxKillArgv(p.id)))?.exitCode === 0) r.closed.push(p.name)
    r.keep.push(...plan.keep)
  }
  if (!all) for (const p of S.panes) if (strandedNow.has(p.name)) r.keep.push({ what: p.name, why: 'answer not read · /agt-clean closes it' })
  if (!panesOnly) await cleanGit($, run, r, { sweepEnv: auto })
  if (all && !panesOnly) await pruneRuns($, run, r)
  if (r.closed.length) $.ui.invalidate('ui.render')
  if (auto && (r.closed.length || r.removed.length || r.branches.length)) $.ui.toast(cleanText({ ...r, keep: [] }))
  return r
}

// A typed /agt-clean also drops run folders under ~/.agentille/state nobody has touched for RUN_TTL_MS: not the run
// in progress, none this session logged to, and none with a live agent or pane. The name is checked before the path
// is built, so only run-<id> folders of this layout can go.
export const RUN_TTL_MS = 14 * 24 * 60 * 60_000

export async function pruneRuns($, run, r) {
  if (!S.home) return
  const dir = S.home + '/.agentille/state'
  const keep = new Set([S.lastRun, ...runs.keys(), ...S.panes.map((p) => splitName(p.name)?.run), ...[...live.values()].map((a) => a.run)])
  for (const e of await $.fs.list(dir).catch(() => [])) {
    if (e.kind !== 'dir' || !e.name.startsWith('run-')) continue
    const id = e.name.slice(4)
    if (!SAFE_RUN.test(id) || id === 'adhoc' || keep.has(id)) continue
    const st = await $.fs.stat(dir + '/run-' + id).catch(() => null)
    if (typeof st?.mtimeMs !== 'number' || Date.now() - st.mtimeMs < RUN_TTL_MS) continue
    if ((await run(['rm', '-rf', dir + '/run-' + id]))?.exitCode === 0) r.runs += 1
  }
}

// Only what this session's runs opened (guard.js records each `git worktree add`): another session's
// worktree, even a merged-looking fresh one, is listed as kept and never read. An owned tree goes once it is
// merged, clean, has commits of its own and is FRESH_MS old. sweepEnv (a run's end) first deletes the
// untracked .env* copies in every owned worktree, so secrets never outlive the run.
export async function cleanGit($, run, r, { sweepEnv = false } = {}) {
  const cwd = await $.session.cwd().catch(() => null)
  if (!cwd) return
  const git = (...a) => run(['git', '-C', cwd, ...a])
  const wl = await git('worktree', 'list', '--porcelain')
  if (wl?.exitCode !== 0) return
  const trees = parseWorktrees(wl.stdout)
  const mine = await ownedWorktrees($).catch(() => [])
  const paths = new Set(mine.map((o) => o.path))
  const names = new Set(mine.map((o) => o.branch).filter(Boolean))
  const born = new Map(mine.map((o) => [o.path, o.head]))
  const owned = (t) => (t.path && paths.has(t.path)) || (!!t.branch && names.has(t.branch))
  const linked = trees.slice(1).filter((t) => !t.prunable && t.path !== cwd)
  // Ages first: deleting a .env copy touches the directory, and would make every swept tree look fresh.
  const ages = new Map()
  for (const t of linked.filter(owned)) ages.set(t.path, (await $.fs.stat(t.path).catch(() => null))?.mtimeMs)
  if (sweepEnv) for (const t of linked.filter(owned)) await run(['git', '-C', t.path, 'clean', '-fqx', '--', '.env*'])
  const lines = (x) => (x?.exitCode === 0 ? String(x.stdout).split('\n').map((l) => l.trim()).filter(Boolean) : [])
  const base = lines(await git('symbolic-ref', '--short', 'refs/remotes/origin/HEAD'))[0]
  const merged = new Set()
  const tips = new Set()
  for (const ref of [base, 'HEAD'].filter(Boolean)) {
    for (const b of lines(await git('branch', '--merged', ref, '--format=%(refname:short)', '--list', 'agt/*'))) merged.add(b)
    const tip = lines(await git('rev-parse', ref))[0]
    if (tip) tips.add(tip)
  }
  const dirty = new Set()
  const empty = new Set()
  const fresh = new Set()
  for (const t of trees.slice(1)) {
    if (!t.branch?.startsWith('agt/') || t.prunable || !merged.has(t.branch) || !owned(t)) continue
    const st = await run(['git', '-C', t.path, 'status', '--porcelain'])
    if (st?.exitCode !== 0 || String(st.stdout).trim()) dirty.add(t.path)
    // No commits of its own: the tip is still where it forked (recorded at `worktree add`); a tree with no
    // recorded fork point counts as empty while its tip is the base's or HEAD's (a fast-forward looks the same).
    const fork = born.get(t.path)
    if (!t.head || (fork ? fork === t.head : tips.has(t.head))) empty.add(t.path)
    const at = ages.get(t.path)
    if (typeof at !== 'number' || Date.now() - at < FRESH_MS) fresh.add(t.path)
  }
  const branches = lines(await git('branch', '--format=%(refname:short)', '--list', 'agt/*'))
  const plan = worktreePlan(trees, merged, dirty, branches, { owned, empty, fresh })
  r.keep.push(...plan.keep)
  for (const t of plan.remove) {
    if ((await git('worktree', 'remove', t.path))?.exitCode === 0) r.removed.push(t.branch)
    else r.keep.push({ what: t.branch, why: 'git refused to remove the worktree' })
  }
  for (const b of plan.deleteBranches) {
    if (!r.removed.includes(b) && plan.remove.some((t) => t.branch === b)) continue
    if ((await git('branch', '-d', b))?.exitCode === 0) r.branches.push(b)
  }
  if (plan.prune) await git('worktree', 'prune')
  if (mine.length) {
    const gone = new Set([...plan.remove.filter((t) => r.removed.includes(t.branch)).map((t) => t.path)])
    await forgetOwned($, trees.filter((t) => !gone.has(t.path)), branches.filter((b) => !r.branches.includes(b))).catch(() => {})
  }
}
