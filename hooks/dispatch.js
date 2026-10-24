// agentille run bookkeeping: per-run counters, the routing log and ledger under ~/.agentille/state/run-<id>/,
// each subagent's raw report, and the Agents section the mod adds to a finished report.md.

import { Profile, Panes, Proofs, Session } from './state.js'
import { makeStore } from './store.js'
import { reportRun, reportTail } from './drawing.js'
import { pieceOf, party, taskLine } from './links.js'
import { newAgent, short, ledger, ledgerText, addUsage, finish, endRoute } from './live.js'
import { SAFE_RUN, splitName } from './panes.js'
import { formationOf, roleOf, parseHeader, proveHeader, demoteHeaderText, ladderFixes, decide, executorsWorking, executorCapFlag, estimateRunUsd, maxRunUsdOf, usd } from './routing.js'
import { addFlag } from './display.js'
import { noteWire } from './worker.js'
import { agtTurnFromDispatch } from './proofs.js'
import { adopt, applyStatus, quietWorkflows } from './tree.js'

// The run bookkeeping store: the run the band follows, each run's counters and routing log, every agent this session
// has seen, the dispatch decisions and the pane routes. Read through the Runs view; written only here.
const { s: my, view, raw } = makeStore('dispatch.js', {
  lastRun: 'adhoc',
  runs: new Map(),  // run id → { revise, fixes, fable, formation, log: [], reports: { role → count } }
  live: new Map(),  // agentId → live agent (live.js)
  decisions: [],  // this session, for /agt-info routing
  paneRoutes: [],  // PaneRoute[], append-only: how each worker this lead opened was routed
})
export const Runs = view
const wfToasted = new Set()  // run:role pairs whose drift the person was told once
const demotedToasted = new Set()  // run ids told once that fable=forced was dropped for want of a typed --fable

// The band follows this run (a pane opened for it, or a routed dispatch named it).
export function setLastRun(id) {
  my.lastRun = id
}

// A worker pane this lead opened, and how it was routed.
export function addRoute(route) {
  my.paneRoutes.push(route)
}

// A dispatch decision, for /agt-info routing.
export function addDecision(rec) {
  my.decisions.push(rec)
}

// The engine's agent list names agents the map has not seen (a reload, a foreign spawn): they join the band's run.
export function adoptAgents(list, now) {
  return adopt(my.live, list, { run: my.lastRun, now })
}

// The list's view of each known agent folds into its record (tree.js applyStatus). Returns whether anything changed.
export function applyAgentList(list, now) {
  return applyStatus(my.live, list, now)
}

// Every working workflow agent silent too long is finished (tree.js quietWorkflows). Returns whether any was.
export function quietAgents(now) {
  return quietWorkflows(my.live, now)
}

const agentOf = (id) => (id == null ? undefined : my.live.get(id))

// A subagent called a tool: its band row shows the call, and it was heard from now. False when no agent has the id.
export function noteAgentTool(id, label) {
  const a = agentOf(id)
  if (!a) return false
  a.tool = label
  a.heard = Date.now()
  return true
}

// A workflow agent inside one long call (a full test suite) is alive: tree.js quietWorkflows skips it while a call
// is open, and the return counts as heard.
export function enterAgentCall(id) {
  const a = agentOf(id)
  if (a) a.calls = (a.calls ?? 0) + 1
}

export function leaveAgentCall(id) {
  const a = agentOf(id)
  if (!a) return
  a.calls -= 1
  a.heard = Date.now()
}

// A subagent's model step ended: it was heard from, the effort and model it ran on fill in when none was known, and
// its tokens count. False when no agent has the id.
export function noteAgentStep(id, { effort, model, usage } = {}) {
  const a = agentOf(id)
  if (!a) return false
  a.heard = Date.now()
  if (!a.effort && effort) a.effort = String(effort)
  if (!a.model && model) a.model = model
  addUsage(a, usage)
  return true
}

// A subagent's turn ended: its tool clears, its verdict chip is set, its tokens count if no step counted them, and
// it is done.
export function agentDone(id, { verdict, usage, now, durationMs }) {
  const a = agentOf(id)
  if (!a) return
  a.tool = null
  a.verdict = verdict
  if (a.input + a.output === 0) addUsage(a, usage)
  finish(a, now, durationMs)
}

// A worker pane's done message: its newest route takes the verdict chip.
export function setRouteVerdict(name, verdict) {
  const r = my.paneRoutes.findLast((x) => x.name === name)
  if (r) r.verdict = verdict
}

// A pane left the stage: its newest open route ends now. Returns that route's run, or null when none was open.
export function endPaneRoute(name, now) {
  return endRoute(my.paneRoutes, name, now)?.run ?? null
}

// A workflow agent is in no agent list, and a cancelled one raises no turn.complete: it is marked,
// and every event of its loop says it is still alive (tree.js quietWorkflows ends a silent one).
export function heard(a, e) {
  if (e.workflow) a.workflow = e.workflow.runId || true
  a.heard = Date.now()
  return a
}

// Once per run: the model wrote fable=forced, nobody typed --fable, so the ladder applies.
export function demoteToast($, run) {
  if (demotedToasted.has(run)) return
  demotedToasted.add(run)
  $.ui.toast('agt ⚑ fable=forced dropped: --fable was not typed, the ladder applies')
}

// Once per run: the maxRunUsd ceiling was reached and the first dispatch (subagent or pane) was demoted. One toast and
// a band ⚑ line that name what was demoted and what follows; every later demotion shows only in the routing log
// (`capped: true`).
export function ceilingOnce($, runId, spent, role, d) {
  const run = runRec(runId)
  if (run.ceilingToasted) return
  run.ceilingToasted = true
  addFlag($, 'ceiling|' + runId, 'run ' + runId + ': ~' + usd(spent) + ' spent, past maxRunUsd ' + usd(maxRunUsdOf(Profile.settings)) + '; ' + role + ' ' + (d.from ?? 'opus') + ' → sonnet, and every later Opus or Fable planner, reviewer, ui-prototyper and adversary runs Sonnet (the executor keeps its route)')
}

// The run's spend so far for the ceiling, subagents and pane workers alike, or null when no ceiling is set.
export function runSpend(runId) {
  return maxRunUsdOf(Profile.settings) == null ? null : estimateRunUsd(my.live, runId, my.paneRoutes)
}

// A run's counters, made on first use. runRec is this module's writable record; runState is the read view of it.
function runRec(id) {
  if (!my.runs.has(id)) my.runs.set(id, { revise: 0, fixes: 0, fixesByPiece: {}, fable: 0, formation: null, log: [], reports: {} })
  return my.runs.get(id)
}

export function runState(id) {
  runRec(id)
  return view.runs.get(id)
}

// The run's formation, when this dispatch's header names one.
export function noteFormation(id, hdr) {
  const run = runRec(id)
  run.formation = formationOf(hdr) ?? run.formation
}

// A plan-reviewer said REVISE.
export function countRevise(id) {
  runRec(id).revise += 1
}

// One more fix round, for the run and for its piece ('' = no piece): the ladder reads the piece's rounds.
export function countFix(id, piece) {
  const run = runRec(id)
  const key = piece ?? ''
  run.fixes += 1
  run.fixesByPiece[key] = (run.fixesByPiece[key] ?? 0) + 1
}

// The run's Fable count is shared across sessions through $.store: take the higher of the two before a pick,
// and write the new count back after a Fable dispatch.
export async function syncFable($, id) {
  const run = runRec(id)
  run.fable = Math.max(run.fable, Number((await $.store.get('fable:' + id)) ?? 0))
  return run.fable
}

export async function countFable($, id) {
  const run = runRec(id)
  run.fable += 1
  await $.store.set('fable:' + id, run.fable)
}

// A dispatch decision goes to /agt-info routing and to the run's routing log, which is written out whole.
export async function logDecision($, id, rec) {
  my.decisions.push(rec)
  const run = runRec(id)
  run.log.push(JSON.stringify(rec))
  await writeRunFile($, id, 'routing.jsonl', run.log.join('\n') + '\n')
}

export function shortType(t) {
  return String(t ?? 'agent').split(':').pop()
}

export function routingView() {
  if (my.decisions.length === 0) return 'No agentille dispatches this session.'
  return my.decisions.slice(-30).map((d) => d.role + ' → ' + d.model + (d.effort ? ' · ' + d.effort : '') + (d.reason === 'table' ? '' : '  (' + d.reason + ')') + (d.kind === 'pane' ? ' · pane' : '')).join('\n')
}

export function ledgerView() {
  const text = ledgerText(ledger(my.live, my.lastRun, my.paneRoutes))
  const max = maxRunUsdOf(Profile.settings)
  return max == null ? text : text + '\nestimate ~' + usd(estimateRunUsd(my.live, my.lastRun, my.paneRoutes)) + ' of maxRunUsd ' + usd(max) + ' (list prices; pane workers estimated from their minutes open)'
}

export async function writeRunFile($, runId, name, text) {
  if (!Profile.home || !SAFE_RUN.test(runId) || runId === 'adhoc') return
  try {
    await $.fs.write(Profile.home + '/.agentille/state/run-' + runId + '/' + name, text)
  } catch {
    // the run dir is the orchestrator's; logging never blocks a dispatch
  }
}

// A subagent's raw answer goes to run-<id>/agents/<role>-<n>.md, written here so the lead spends
// no tokens copying it. n counts per role in the run; a second turn of the same agent overwrites.
export async function writeReport($, a, answer) {
  a = raw(a) // read through the Runs view by the caller: the report name is written on the record itself
  if (!a?.routed || !answer) return
  const counts = runRec(a.run).reports
  a.report ??= a.role + '-' + (counts[a.role] = (counts[a.role] ?? 0) + 1) + '.md'
  await writeRunFile($, a.run, 'agents/' + a.report, answer)
}

// The run an agent's files and counters belong to: a headerless workflow agent files under 'adhoc'.
export const fileRunOf = (a) => a.fileRun ?? a.run

// /agt writes report.md once at the end; the mod adds the Agents and Raw reports sections it lacks.
export async function completeReport($, path) {
  const run = reportRun(path)
  if (!run || !Profile.home) return
  const dir = Profile.home + '/.agentille/state/run-' + run
  if (path !== dir + '/report.md') return
  try {
    const text = await $.fs.read(path)
    const files = (await $.fs.list(dir + '/agents').catch(() => [])).filter((f) => f.kind !== 'dir' && f.name.endsWith('.md')).map((f) => f.name)
    const agents = [...my.live.values()].filter((a) => fileRunOf(a) === run)
    const tail = reportTail(text, { agents, routes: my.paneRoutes.filter((r) => r.run === run), files })
    if (tail) await $.fs.write(path, text + tail)
  } catch {
    // the report is the lead's; a missing section never fails its Write
  }
}

// Every Agent dispatch of an agentille role: the header is proved, the model rewritten by the table and the
// ladder, the run's counters moved, the routing logged. A foreign subagent is only watched for the band.
export async function dispatchAgent($, e, next) {
  if (e.fork) return next(e)
  const role = roleOf(e.subagentType)

  if (!role) {
    const res = await next(e)
    if (res.agentId) my.live.set(res.agentId, heard(newAgent({ id: res.agentId, role: shortType(e.subagentType), routed: false, model: res.model, effort: null, reason: null, run: my.lastRun, now: Date.now(), parentId: e.parentAgentId ?? null }), e))
    $.ui.invalidate('ui.render')
    return res
  }

  const proof = proveHeader(parseHeader(e.prompt) ?? {}, { fableTyped: Proofs.fableTyped })
  const hdr = proof.hdr
  if (proof.demoted) {
    e = { ...e, prompt: demoteHeaderText(e.prompt) }
    demoteToast($, SAFE_RUN.test(hdr.run ?? '') ? hdr.run : my.lastRun)
  }
  // A workflow script's agent: the engine ignores a rewrite there (and logs a failure line), so
  // it runs on the model the script chose. Log that model, not the table's, and flag a mismatch.
  if (e.workflow) {
    // Its prompt may carry no header: it then joins the run in progress rather than reset it. A header
    // names its run, but the band moves to it only when the current run has nothing working, subagent or pane.
    const named = SAFE_RUN.test(hdr.run ?? '') ? hdr.run : null
    const runId = named ?? my.lastRun
    // Its files and counters follow the header: a headerless agent files under 'adhoc' (which writes
    // nothing), so the run in progress keeps only its own routing log and ledger.
    const fileRun = named ?? 'adhoc'
    const busy = [...my.live.values()].some((a) => a.run === my.lastRun && a.state === 'working') || Panes.panes.some((p) => splitName(p.name)?.run === my.lastRun && p.state === 'working')
    if (named && (my.lastRun === 'adhoc' || !busy)) my.lastRun = named
    agtTurnFromDispatch()
    // The table pick follows the run in progress (its REVISEs); `run` is only where the log goes.
    const d = decide({ role, hdr, run: { ...runRec(runId), fixes: ladderFixes(runRec(runId), pieceOf(hdr)) }, depth: Profile.depth, settings: Profile.settings, weeklyPct: Session.weeklyPct })
    const res = await next(e)
    if (res.deny) return res
    const off = short(res.model) !== short(d.model)
    const drift = off ? 'workflow, table says ' + d.model + ' · ' + d.effort : 'workflow'
    if (res.agentId) {
      const a = heard(newAgent({ id: res.agentId, role, routed: false, model: res.model, effort: null, reason: off ? drift : null, run: runId, now: Date.now(), parentId: e.parentAgentId ?? null }), e)
      a.fileRun = fileRun
      a.piece = pieceOf(hdr)
      my.live.set(res.agentId, a)
    }
    const rec = { at: new Date().toISOString(), role, model: res.model, effort: null, reason: drift, asked: e.model ?? null, agentId: res.agentId ?? null, kind: 'workflow' }
    await logDecision($, fileRun, rec)
    if (off && !wfToasted.has(runId + ':' + role)) {
      wfToasted.add(runId + ':' + role)
      $.ui.toast('agt workflow ' + role + ' runs ' + short(res.model) + ' — table says ' + d.model + ' · ' + d.effort)
    }
    $.ui.invalidate('ui.render')
    return res
  }

  const runId = SAFE_RUN.test(hdr.run ?? '') ? hdr.run : 'adhoc'
  agtTurnFromDispatch()
  my.lastRun = runId
  const run = runRec(runId)
  noteFormation(runId, hdr)
  if (role === 'executor' && hdr.mode === 'fix') countFix(runId, pieceOf(hdr))
  await syncFable($, runId)

  // The run's spend so far, estimated from its agents' tokens and its panes' minutes, only when a ceiling is set.
  const spent = runSpend(runId)
  const d = decide({ role, hdr, run: { ...run, fixes: ladderFixes(run, pieceOf(hdr)), usd: spent }, depth: Profile.depth, settings: Profile.settings, weeklyPct: Session.weeklyPct })
  const res = await next({ ...e, model: d.model })
  if (res.deny) return res

  if (d.fable) await countFable($, runId)
  const piece = pieceOf(hdr)
  // At most 3 executors at once: counted before this one joins, subagents and the run's executor panes alike.
  const cap = role === 'executor' && runId !== 'adhoc' && res.agentId ? executorCapFlag(runId, executorsWorking(my.live, my.paneRoutes, runId) + 1) : null
  if (res.agentId) my.live.set(res.agentId, { ...newAgent({ id: res.agentId, role, routed: true, model: res.model, effort: d.effort, reason: d.reason, run: runId, now: Date.now(), parentId: e.parentAgentId ?? null }), piece })
  if (runId !== 'adhoc') noteWire({ from: 'lead', to: party(role, piece), kind: 'task', summary: taskLine(e.prompt) || role, at: Date.now(), via: 'sub' })
  const rec = { at: new Date().toISOString(), role, model: res.model, effort: d.effort, reason: d.reason, asked: e.model ?? null, agentId: res.agentId ?? null, ...(cap && { cap }), ...(d.capped && { capped: true }) }
  await logDecision($, runId, rec)
  if (cap) addFlag($, 'cap|' + runId, cap) // the band's ⚑ line and one toast; the dispatch itself goes ahead
  if (d.capped) ceilingOnce($, runId, spent, role, d)
  else if (d.reason !== 'table') $.ui.toast('agt ↑ ' + role + ' → ' + short(res.model) + ' · ' + d.effort + ' — ' + d.reason)
  $.ui.invalidate('ui.render')
  return res
}
