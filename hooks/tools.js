// agentille pane tools: the handlers behind spawn_pane, open_sessions and close_pane. Each checks the typed proof
// the mod holds (S.agtTyped, S.sessionsAsked), the installed version and the transport before it touches a pane;
// register.js only wires them to tool.call.

import { S } from './state.js'
import { demoteToast, runState, writeRunFile } from './dispatch.js'
import { pieceOf, party, taskLine } from './links.js'
import { PROBE, newRunId, doneFile, paneKey, answerFile, tmuxKillArgv, placePlan, codexNote, herdrCloseArgv, paneRole, spawnToolInput, closeTarget, sessionName, sessionsToolInput, sessionsNote } from './panes.js'
import { installedSkew } from './profile.js'
import { pollNow } from './reaper.js'
import { formationOf, mentionsFable, proveHeader, demoteHeaderText, ladderFixes, decide } from './routing.js'
import { saveSessions, closeSession, openSession } from './sessions.js'
import { skewMessage } from './skew.js'
import { transportOf, openPane, savePanes } from './spawn.js'
import { ensurePolling, ensureTicker } from './ticker.js'
import { shortName, logWire } from './wire.js'
const { decisions, paneRoutes, openedNames, paneSeen, harvested, wireDone, woken, strandedToasted, firstSeen, ownedTabs, wireLog } = S

// spawn_pane: the /agt heavy level's worker pane, the same openPane as /agt-spawn, with the input validated here.
export async function spawnPane($, e) {
  if (S.selfName || S.worker) return { deny: 'This is a worker pane (' + (S.selfName ?? S.worker.agent) + '); workers do not open panes.' }
  // An update since this session started leaves it on old code: its workers would never report.
  const skew = await installedSkew($)
  if (skew) {
    if (!S.skewToasted) $.ui.toast('agt ⚑ ' + skewMessage(skew, S.runningVersion))
    S.skewToasted = true
    return { deny: skewMessage(skew, S.runningVersion) }
  }
  const t = await transportOf($)
  if (t === 'none') return { deny: 'No pane transport here: run the slice as a subagent.' }
  if (!S.agtTyped) return { deny: 'spawn_pane opens worker panes only in a session where /agt was typed.' }
  const a = spawnToolInput(e, S.panes)
  if (a.error) return { deny: a.error }
  const proof = proveHeader(a.hdr, { fableTyped: S.fableTyped })
  if (proof.demoted) {
    a.hdr = proof.hdr
    a.header = demoteHeaderText(a.header)
    a.task = demoteHeaderText(a.task)
    demoteToast($, a.run)
  }
  const cwd = a.cwd ?? (await $.session.cwd())
  if (a.cwd) {
    const s = await $.fs.stat(cwd).catch(() => null)
    if (s?.kind !== 'dir') return { deny: cwd + ' is not a directory.' }
  }
  S.agtTurn = true
  S.lastRun = a.run
  const run = runState(a.run)
  run.formation = formationOf(a.hdr) ?? run.formation
  // Counted only once the pane opens: a failed split is not a fix attempt. The ladder sees this piece's rounds only.
  const isFix = a.agent === 'executor' && a.hdr.mode === 'fix'
  const fixKey = pieceOf(a.hdr) ?? ''
  const fixes = ladderFixes(run, pieceOf(a.hdr)) + (isFix ? 1 : 0)
  run.fable = Math.max(run.fable, Number((await $.store.get('fable:' + a.run)) ?? 0))
  const codex = a.vendor === 'codex'
  if (codex && t !== 'herdr') return { deny: 'Codex panes need Herdr; run this slice as a Claude pane or subagent.' }
  // Codex runs on the person's own config: no routed model or effort, no Fable count.
  const d = codex ? { model: 'codex', effort: '', reason: 'table', fable: false } : decide({ role: a.agent, hdr: a.hdr, run: { ...run, fixes }, depth: S.depth, settings: S.settings, weeklyPct: S.weeklyPct })
  const r = paneRole(a.agent)
  if (!r.pane) return { deny: r.why }
  await pollNow($, t)
  S.opened = S.opened.filter((o) => S.panes.some((p) => p.id === o.id))
  const lead = t === 'tmux' ? await $.env.get('TMUX_PANE') : await $.env.get('HERDR_PANE_ID')
  const plan = placePlan({ transport: t, layout: a.layout, run: a.run, lead, opened: S.opened, live: S.panes })
  // A respawned role (a fix round, a retry) must not inherit the earlier pane's done file: the SessionEnd sweep
  // and the tmux poll would read the new worker as finished and close it mid-slice.
  const stale = doneFile(S.home, a.run, a.role)
  if (stale) await $.process.run(['rm', '-f', stale], PROBE).catch(() => {})
  let id
  let tab
  try {
    const made = await openPane($, t, { run: a.run, name: a.name, agent: a.agent, vendor: a.vendor, model: d.model, effort: d.effort, task: a.task, cwd, newTab: !!plan.newTab, split: plan.newTab ? null : { target: plan.target, direction: plan.direction, tab: plan.tab } })
    id = made.id
    tab = made.tab
  } catch (err) {
    return { deny: 'Could not open a ' + t + ' pane: ' + String(err?.message ?? err).slice(0, 160) }
  }
  // A role can be respawned (a fix, a retry), and the multiplexer can hand the old pane's id out again. Harvest state is
  // keyed by pane id and the list call above may have failed, so wipe whatever the id carries: the new pane starts with
  // nothing harvested and only files written from now on count as its own.
  firstSeen.set(id, await $.clock.now())
  for (const s of [harvested, wireDone, woken, strandedToasted]) s.delete(id)
  paneSeen.delete(id)
  if (isFix) {
    run.fixes += 1
    run.fixesByPiece[fixKey] = (run.fixesByPiece[fixKey] ?? 0) + 1
  }
  if (d.fable) {
    run.fable += 1
    await $.store.set('fable:' + a.run, run.fable)
  }
  S.opened.push({ id, name: a.name, run: a.run, tab })
  openedNames.add(a.name)
  await savePanes($)
  const piece = pieceOf(a.hdr)
  paneRoutes.push({ name: a.name, run: a.run, role: a.role, agent: a.agent, model: d.model, effort: d.effort, reason: d.reason, start: Date.now(), end: null, piece, verdict: null })
  logWire(wireLog, { from: 'lead', to: party(shortName(a.name), piece), kind: 'task', summary: taskLine(a.task) || a.agent, at: Date.now() })
  const rec = { at: new Date().toISOString(), role: a.agent, model: d.model, effort: d.effort, reason: d.reason, asked: a.asked, agentId: null, kind: 'pane', pane: a.name }
  decisions.push(rec)
  run.log.push(JSON.stringify(rec))
  await writeRunFile($, a.run, 'routing.jsonl', run.log.join('\n') + '\n')
  await pollNow($, t)
  ensurePolling($)
  ensureTicker($)
  if (d.reason !== 'table') $.ui.toast('agt ↑ ' + a.agent + ' → ' + d.model + ' · ' + d.effort + ' — ' + d.reason)
  return { result: 'Opened ' + a.name + ' · ' + d.model + (codex ? '' : ' · ' + d.effort) + ' · ' + t + ' pane.' + (d.reason === 'table' ? '' : ' (' + d.reason + ')') + (codex ? codexNote(a.name, answerFile(S.home, a.run, a.role, paneKey(id))) : '') }
}

// open_sessions: panes the person asked for, their own, like ones opened by hand. No worker env, no agt- name and
// no wire, so the band, the reaper and the sweeps leave them alone; each one is a lead of its own.
export async function openSessions($, e) {
  if (S.selfName || S.worker) return { deny: 'This is a worker pane (' + (S.selfName ?? S.worker.agent) + '); workers do not open sessions.' }
  const skew = await installedSkew($)
  if (skew) {
    if (!S.skewToasted) $.ui.toast('agt ⚑ ' + skewMessage(skew, S.runningVersion))
    S.skewToasted = true
    return { deny: skewMessage(skew, S.runningVersion) }
  }
  const t = await transportOf($)
  if (t === 'none') return { deny: 'No pane transport here: sessions open as panes only inside Herdr or tmux.' }
  if (!S.sessionsAsked) return { deny: 'open_sessions runs only on a turn where the person typed a request for sessions, panes or terminals.' }
  const a = sessionsToolInput(e, { typed: S.lastTyped, fableTyped: mentionsFable(S.lastTyped) })
  if (a.error) return { deny: a.error }
  if (a.kind === 'codex' && t !== 'herdr') return { deny: 'Codex sessions need Herdr.' }
  const cwd = a.cwd ?? (await $.session.cwd())
  if (a.cwd) {
    const s = await $.fs.stat(cwd).catch(() => null)
    if (s?.kind !== 'dir') return { deny: cwd + ' is not a directory.' }
  }
  const run = newRunId()
  const tab = t === 'herdr' && a.layout === 'tab'
  const names = []
  let prev = null
  let failed = null
  for (let n = 0; n < a.count; n++) {
    const name = sessionName(run, n + 1)
    // Each session goes under the one before it; a stacked call starts under the newest stacked session.
    const after = prev ?? (tab ? null : S.sessions.filter((x) => !x.tab).at(-1) ?? null)
    try {
      prev = await openSession($, t, { name, kind: a.kind, model: a.model, task: a.tasks[n], cwd, after, newTab: tab && !prev })
    } catch (err) {
      failed = String(err?.message ?? err).slice(0, 160)
      break
    }
    S.sessions.push(prev)
    names.push(name)
  }
  if (!names.length) return { deny: 'Could not open a ' + t + ' pane: ' + failed }
  if (t === 'herdr') await saveSessions($)
  ensurePolling($)
  const what = a.kind === 'claude' ? 'Claude' + (a.model ? ' · ' + a.model : '') : a.kind === 'codex' ? 'Codex' : 'shell'
  const stop = failed ? ' Session ' + (names.length + 1) + ' failed: ' + failed : ''
  return { result: 'Opened ' + names.join(', ') + ' · ' + what + ' · ' + t + (names.length > 1 ? ' panes.' : ' pane.') + stop + sessionsNote(t, a.kind) }
}

// close_pane: one of this lead's own worker panes or sessions, by name.
export async function closePane($, e) {
  if (S.selfName || S.worker) return { deny: 'This is a worker pane (' + (S.selfName ?? S.worker.agent) + '); workers do not close panes.' }
  const t = await transportOf($)
  if (t === 'none') return { deny: 'No pane transport here.' }
  const s = S.sessions.find((x) => x.name === (typeof e.name === 'string' ? e.name.trim() : ''))
  if (s) {
    const c = await closeSession($, t, s)
    if (c === 'failed') return { deny: 'Could not close ' + s.name + '.' }
    return { result: c === 'closed' ? 'Closed ' + s.name + '.' : s.name + ' is already closed.' }
  }
  await pollNow($, t)
  const c = closeTarget(e, S.panes, t === 'herdr' && S.selfTab ? [S.selfTab, ...ownedTabs] : null, openedNames)
  if (c.gone) return { result: c.gone + ' is already closed (the reaper closed it after its answer was saved).' }
  if (c.error) return { deny: c.error }
  const r = await $.process.run(t === 'herdr' ? herdrCloseArgv(c.pane.id) : tmuxKillArgv(c.pane.id), PROBE).catch(() => null)
  if (!r || r.exitCode !== 0) return { deny: 'Could not close ' + c.pane.name + '.' }
  harvested.add(c.pane.id)
  await pollNow($, t)
  return { result: 'Closed ' + c.pane.name + '.' }
}
