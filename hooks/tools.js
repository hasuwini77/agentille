// agentille pane tools: the handlers behind spawn_pane, open_sessions and close_pane. Each checks the typed proof
// the mod holds (proofs.js: spawnAllowed, sessionsAllowed), the installed version and the transport before it touches a pane;
// register.js only wires them to tool.call.

import { isLead, Profile, Spawn, Panes, Sessions, Proofs, Session, markSkewToasted } from './state.js'
import { demoteToast, runState, writeRunFile, runSpend, ceilingOnce, setLastRun, addRoute, addDecision } from './dispatch.js'
import { pieceOf, party, taskLine } from './links.js'
import { PROBE, newRunId, doneFile, paneKey, answerFile, tmuxKillArgv, placePlan, codexNote, herdrCloseArgv, paneRole, spawnToolInput, closeTarget, sessionName, sessionsToolInput, sessionsNote, droppedNote } from './panes.js'
import { installedSkew } from './profile.js'
import { pollNow } from './reaper.js'
import { spawnAllowed, sessionsAllowed, fableProof, moment, startRun, agtTurnFromDispatch, flight } from './proofs.js'
import { formationOf, mentionsCodex, mentionsFable, proveHeader, demoteHeaderText, ladderFixes, decide, runStop } from './routing.js'
import { saveSessions, closeSession, openSession, addSession } from './sessions.js'
import { skewMessage } from './skew.js'
import { transportOf, openPane, savePanes, ownName } from './spawn.js'
import { tmuxInit } from './tmux-env.js'
import { ensurePolling, ensureTicker } from './ticker.js'
import { shortName } from './wire.js'
import { noteWire } from './worker.js'
import * as P from './panerec.js'

// { id, name, run, tab } of the panes this lead opened via spawn_pane, in spawn order: where the next one splits.
let opened = []

// spawn_pane: the /agt heavy level's worker pane, the same openPane as /agt-spawn, with the input validated here.
export async function spawnPane($, e) {
  if (!isLead()) return { deny: 'This is a worker pane (' + (Session.selfName ?? Session.worker.agent) + '); workers do not open panes.' }
  // An update since this session started leaves it on old code: its workers would never report.
  const skew = await installedSkew($)
  if (skew) {
    if (!Session.skewToasted) $.ui.toast('agt ⚑ ' + skewMessage(skew, Session.runningVersion))
    markSkewToasted()
    return { deny: skewMessage(skew, Session.runningVersion) }
  }
  const t = await transportOf($)
  if (t === 'none') return { deny: 'No pane transport here: run the slice as a subagent.' }
  if (!Proofs.agtTyped) return { deny: spawnAllowed() }
  await pollNow($, t) // the panes as they are now: one that closed since the last poll no longer keeps the run going
  const at = await moment($)
  const why = spawnAllowed(null, flight, at)
  if (why) return { deny: why }
  const a = spawnToolInput(e, Panes.panes)
  if (a.error) return { deny: a.error }
  const other = spawnAllowed(a.run, flight, at)
  if (other) return { deny: other }
  // Codex is the person's pick, never the lead's: their /agt prompt or their newest typed prompt names it.
  const codex = a.vendor === 'codex'
  if (codex && !mentionsCodex(Proofs.agtPrompt) && !mentionsCodex(Proofs.lastTyped)) return { deny: 'vendor "codex" runs only when the person asked for Codex in their prompt, so run this slice as a Claude pane.' }
  if (codex && t !== 'herdr') return { deny: 'Codex panes need Herdr; run this slice as a Claude pane or subagent.' }
  const proof = proveHeader(a.hdr, { fableTyped: fableProof() })
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
  agtTurnFromDispatch()
  setLastRun(a.run)
  const run = runState(a.run)
  run.formation = formationOf(a.hdr) ?? run.formation
  // Counted only once the pane opens: a failed split is not a fix attempt. The ladder sees this piece's rounds only.
  const isFix = a.agent === 'executor' && a.hdr.mode === 'fix'
  const fixKey = pieceOf(a.hdr) ?? ''
  const fixes = ladderFixes(run, pieceOf(a.hdr)) + (isFix ? 1 : 0)
  run.fable = Math.max(run.fable, Number((await $.store.get('fable:' + a.run)) ?? 0))
  // Codex runs on the person's own config: no routed model or effort, no Fable count.
  // The ceiling counts this run's subagents and its pane workers (estimated from their minutes open).
  const spent = runSpend(a.run)
  const d = codex ? { model: 'codex', effort: '', reason: 'table', fable: false } : decide({ role: a.agent, hdr: a.hdr, run: { ...run, fixes, usd: spent }, depth: Profile.depth, settings: Profile.settings, weeklyPct: Session.weeklyPct })
  // routing.stopAtCeiling: a run at its ceiling opens no more panes, a Codex one included.
  const stop = d.stop ?? runStop({ usd: spent }, Profile.settings)
  if (stop) return { deny: stop }
  const r = paneRole(a.agent)
  if (!r.pane) return { deny: r.why }
  await pollNow($, t)
  opened = opened.filter((o) => Panes.panes.some((p) => p.id === o.id))
  const lead = t === 'tmux' ? await $.env.get('TMUX_PANE') : await $.env.get('HERDR_PANE_ID')
  const plan = placePlan({ transport: t, layout: a.layout, run: a.run, lead, opened, live: Panes.panes })
  // A respawned role (a fix round, a retry) must not inherit the earlier pane's done file: the SessionEnd sweep
  // and the tmux poll would read the new worker as finished and close it mid-slice.
  const stale = doneFile(Profile.home, a.run, a.role)
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
  const now = await $.clock.now()
  P.forget(id)
  P.rec(id).firstSeen = now
  if (isFix) {
    run.fixes += 1
    run.fixesByPiece[fixKey] = (run.fixesByPiece[fixKey] ?? 0) + 1
  }
  if (d.fable) {
    run.fable += 1
    await $.store.set('fable:' + a.run, run.fable)
  }
  startRun(a.run)
  opened.push({ id, name: a.name, run: a.run, tab })
  ownName(a.name)
  await savePanes($)
  const piece = pieceOf(a.hdr)
  addRoute({ name: a.name, run: a.run, role: a.role, agent: a.agent, model: d.model, effort: d.effort, reason: d.reason, start: Date.now(), end: null, piece, verdict: null })
  noteWire({ from: 'lead', to: party(shortName(a.name), piece), kind: 'task', summary: taskLine(a.task) || a.agent, at: Date.now() })
  const rec = { at: new Date().toISOString(), role: a.agent, model: d.model, effort: d.effort, reason: d.reason, asked: a.asked, agentId: null, kind: 'pane', pane: a.name, ...(d.capped && { capped: true }) }
  addDecision(rec)
  run.log.push(JSON.stringify(rec))
  await writeRunFile($, a.run, 'routing.jsonl', run.log.join('\n') + '\n')
  await pollNow($, t)
  ensurePolling($)
  ensureTicker($)
  if (d.capped) ceilingOnce($, a.run, run, spent, a.agent, d)
  else if (d.reason !== 'table') $.ui.toast('agt ↑ ' + a.agent + ' → ' + d.model + ' · ' + d.effort + ' — ' + d.reason)
  return { result: 'Opened ' + a.name + ' · ' + d.model + (codex ? '' : ' · ' + d.effort) + ' · ' + t + ' pane.' + (d.reason === 'table' ? '' : ' (' + d.reason + ')') + (codex ? codexNote(a.name, answerFile(Profile.home, a.run, a.role, paneKey(id))) : '') }
}

// open_sessions: panes the person asked for, their own, like ones opened by hand. No worker env, no agt- name and
// no wire, so the band and the worker reaper leave them alone; each one is a lead of its own. On Herdr a Claude or
// Codex session is closed when idle: after SESSION_IDLE_MS unfocused (panes.js → sessionSweep), and at session end
// (agentille-sweep.sh, from the lead's lead-<pane>.sessions list). A first prompt the person did not type is dropped
// (panes.js sessionsToolInput): the session opens without it and the result says so.
export async function openSessions($, e) {
  if (!isLead()) return { deny: 'This is a worker pane (' + (Session.selfName ?? Session.worker.agent) + '); workers do not open sessions.' }
  const skew = await installedSkew($)
  if (skew) {
    if (!Session.skewToasted) $.ui.toast('agt ⚑ ' + skewMessage(skew, Session.runningVersion))
    markSkewToasted()
    return { deny: skewMessage(skew, Session.runningVersion) }
  }
  const t = await transportOf($)
  if (t === 'none') return { deny: 'No pane transport here: sessions open as panes only inside Herdr or tmux.' }
  if (!sessionsAllowed()) return { deny: 'open_sessions runs only on a turn where the person typed a request for sessions, panes or terminals.' }
  const a = sessionsToolInput(e, { typed: Proofs.lastTyped, fableTyped: mentionsFable(Proofs.lastTyped) })
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
    const after = prev ?? (tab ? null : Sessions.sessions.filter((x) => !x.tab).at(-1) ?? null)
    try {
      prev = await openSession($, t, { name, kind: a.kind, model: a.model, task: a.tasks[n], cwd, after, newTab: tab && !prev })
    } catch (err) {
      failed = String(err?.message ?? err).slice(0, 160)
      break
    }
    addSession(prev)
    names.push(name)
  }
  if (!names.length) return { deny: 'Could not open a ' + t + ' pane: ' + failed }
  if (t === 'herdr') await saveSessions($)
  ensurePolling($)
  const what = a.kind === 'claude' ? 'Claude' + (a.model ? ' · ' + a.model : '') : a.kind === 'codex' ? 'Codex' : 'shell'
  const stop = failed ? ' Session ' + (names.length + 1) + ' failed: ' + failed : ''
  return { result: 'Opened ' + names.join(', ') + ' · ' + what + ' · ' + t + (names.length > 1 ? ' panes.' : ' pane.') + stop + droppedNote(a.dropped, names) + sessionsNote(t, a.kind) }
}

// close_pane: one of this lead's own worker panes or sessions, by name.
export async function closePane($, e) {
  if (!isLead()) return { deny: 'This is a worker pane (' + (Session.selfName ?? Session.worker.agent) + '); workers do not close panes.' }
  const t = await transportOf($)
  if (t === 'none') return { deny: 'No pane transport here.' }
  const s = Sessions.sessions.find((x) => x.name === (typeof e.name === 'string' ? e.name.trim() : ''))
  if (s) {
    const c = await closeSession($, t, s)
    if (c === 'failed') return { deny: 'Could not close ' + s.name + '.' }
    return { result: c === 'closed' ? 'Closed ' + s.name + '.' : s.name + ' is already closed.' }
  }
  await pollNow($, t)
  const c = closeTarget(e, Panes.panes, t === 'herdr' && Session.selfTab ? [Session.selfTab, ...Spawn.ownedTabs] : null, Spawn.openedNames)
  if (c.gone) return { result: c.gone + ' is already closed (the reaper closed it after its answer was saved).' }
  if (c.error) return { deny: c.error }
  const kill = t === 'herdr' ? herdrCloseArgv(c.pane.id) : tmuxKillArgv(c.pane.id)
  const r = await $.process.run(kill, tmuxInit(kill, PROBE)).catch(() => null)
  if (!r || r.exitCode !== 0) return { deny: 'Could not close ' + c.pane.name + '.' }
  P.rec(c.pane.id).harvested = true
  await pollNow($, t)
  return { result: 'Closed ' + c.pane.name + '.' }
}
