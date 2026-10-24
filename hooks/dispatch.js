// agentille run bookkeeping: per-run counters, the routing log and ledger under ~/.agentille/state/run-<id>/,
// each subagent's raw report, and the Agents section the mod adds to a finished report.md.

import { S } from './state.js'
import { reportRun, reportTail } from './drawing.js'
import { pieceOf, party, taskLine } from './links.js'
import { newAgent, short, ledger, ledgerText } from './live.js'
import { SAFE_RUN, splitName } from './panes.js'
import { formationOf, roleOf, parseHeader, proveHeader, demoteHeaderText, ladderFixes, decide } from './routing.js'
import { logWire } from './wire.js'
import { agtTurnFromDispatch } from './proofs.js'
const { wfToasted, runs, live, decisions, paneRoutes, demotedToasted, wireLog } = S

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

export function runState(id) {
  if (!runs.has(id)) runs.set(id, { revise: 0, fixes: 0, fixesByPiece: {}, fable: 0, formation: null, log: [], reports: {} })
  return runs.get(id)
}

export function shortType(t) {
  return String(t ?? 'agent').split(':').pop()
}

export function routingView() {
  if (decisions.length === 0) return 'No agentille dispatches this session.'
  return decisions.slice(-30).map((d) => d.role + ' → ' + d.model + (d.effort ? ' · ' + d.effort : '') + (d.reason === 'table' ? '' : '  (' + d.reason + ')') + (d.kind === 'pane' ? ' · pane' : '')).join('\n')
}

export function ledgerView() {
  return ledgerText(ledger(live, S.lastRun, paneRoutes))
}

export async function writeRunFile($, runId, name, text) {
  if (!S.home || !SAFE_RUN.test(runId) || runId === 'adhoc') return
  try {
    await $.fs.write(S.home + '/.agentille/state/run-' + runId + '/' + name, text)
  } catch {
    // the run dir is the orchestrator's; logging never blocks a dispatch
  }
}

// A subagent's raw answer goes to run-<id>/agents/<role>-<n>.md, written here so the lead spends
// no tokens copying it. n counts per role in the run; a second turn of the same agent overwrites.
export async function writeReport($, a, answer) {
  if (!a.routed || !answer) return
  const counts = runState(a.run).reports
  a.report ??= a.role + '-' + (counts[a.role] = (counts[a.role] ?? 0) + 1) + '.md'
  await writeRunFile($, a.run, 'agents/' + a.report, answer)
}

// The run an agent's files and counters belong to: a headerless workflow agent files under 'adhoc'.
export const fileRunOf = (a) => a.fileRun ?? a.run

// /agt writes report.md once at the end; the mod adds the Agents and Raw reports sections it lacks.
export async function completeReport($, path) {
  const run = reportRun(path)
  if (!run || !S.home) return
  const dir = S.home + '/.agentille/state/run-' + run
  if (path !== dir + '/report.md') return
  try {
    const text = await $.fs.read(path)
    const files = (await $.fs.list(dir + '/agents').catch(() => [])).filter((f) => f.kind !== 'dir' && f.name.endsWith('.md')).map((f) => f.name)
    const agents = [...live.values()].filter((a) => fileRunOf(a) === run)
    const tail = reportTail(text, { agents, routes: paneRoutes.filter((r) => r.run === run), files })
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
    if (res.agentId) live.set(res.agentId, heard(newAgent({ id: res.agentId, role: shortType(e.subagentType), routed: false, model: res.model, effort: null, reason: null, run: S.lastRun, now: Date.now(), parentId: e.parentAgentId ?? null }), e))
    $.ui.invalidate('ui.render')
    return res
  }

  const proof = proveHeader(parseHeader(e.prompt) ?? {}, { fableTyped: S.fableTyped })
  const hdr = proof.hdr
  if (proof.demoted) {
    e = { ...e, prompt: demoteHeaderText(e.prompt) }
    demoteToast($, SAFE_RUN.test(hdr.run ?? '') ? hdr.run : S.lastRun)
  }
  // A workflow script's agent: the engine ignores a rewrite there (and logs a failure line), so
  // it runs on the model the script chose. Log that model, not the table's, and flag a mismatch.
  if (e.workflow) {
    // Its prompt may carry no header: it then joins the run in progress rather than reset it. A header
    // names its run, but the band moves to it only when the current run has nothing working, subagent or pane.
    const named = SAFE_RUN.test(hdr.run ?? '') ? hdr.run : null
    const runId = named ?? S.lastRun
    // Its files and counters follow the header: a headerless agent files under 'adhoc' (which writes
    // nothing), so the run in progress keeps only its own routing log and ledger.
    const fileRun = named ?? 'adhoc'
    const run = runState(fileRun)
    const busy = [...live.values()].some((a) => a.run === S.lastRun && a.state === 'working') || S.panes.some((p) => splitName(p.name)?.run === S.lastRun && p.state === 'working')
    if (named && (S.lastRun === 'adhoc' || !busy)) S.lastRun = named
    agtTurnFromDispatch()
    // The table pick follows the run in progress (its REVISEs); `run` is only where the log goes.
    const d = decide({ role, hdr, run: { ...runState(runId), fixes: ladderFixes(runState(runId), pieceOf(hdr)) }, depth: S.depth, settings: S.settings, weeklyPct: S.weeklyPct })
    const res = await next(e)
    if (res.deny) return res
    const off = short(res.model) !== short(d.model)
    const drift = off ? 'workflow, table says ' + d.model + ' · ' + d.effort : 'workflow'
    if (res.agentId) {
      const a = heard(newAgent({ id: res.agentId, role, routed: false, model: res.model, effort: null, reason: off ? drift : null, run: runId, now: Date.now(), parentId: e.parentAgentId ?? null }), e)
      a.fileRun = fileRun
      a.piece = pieceOf(hdr)
      live.set(res.agentId, a)
    }
    const rec = { at: new Date().toISOString(), role, model: res.model, effort: null, reason: drift, asked: e.model ?? null, agentId: res.agentId ?? null, kind: 'workflow' }
    decisions.push(rec)
    run.log.push(JSON.stringify(rec))
    await writeRunFile($, fileRun, 'routing.jsonl', run.log.join('\n') + '\n')
    if (off && !wfToasted.has(runId + ':' + role)) {
      wfToasted.add(runId + ':' + role)
      $.ui.toast('agt workflow ' + role + ' runs ' + short(res.model) + ' — table says ' + d.model + ' · ' + d.effort)
    }
    $.ui.invalidate('ui.render')
    return res
  }

  const runId = SAFE_RUN.test(hdr.run ?? '') ? hdr.run : 'adhoc'
  agtTurnFromDispatch()
  S.lastRun = runId
  const run = runState(runId)
  run.formation = formationOf(hdr) ?? run.formation
  if (role === 'executor' && hdr.mode === 'fix') {
    const key = pieceOf(hdr) ?? ''
    run.fixes += 1
    run.fixesByPiece[key] = (run.fixesByPiece[key] ?? 0) + 1
  }
  const shared = Number((await $.store.get('fable:' + runId)) ?? 0)
  run.fable = Math.max(run.fable, shared)

  const d = decide({ role, hdr, run: { ...run, fixes: ladderFixes(run, pieceOf(hdr)) }, depth: S.depth, settings: S.settings, weeklyPct: S.weeklyPct })
  const res = await next({ ...e, model: d.model })
  if (res.deny) return res

  if (d.fable) {
    run.fable += 1
    await $.store.set('fable:' + runId, run.fable)
  }
  const piece = pieceOf(hdr)
  if (res.agentId) live.set(res.agentId, { ...newAgent({ id: res.agentId, role, routed: true, model: res.model, effort: d.effort, reason: d.reason, run: runId, now: Date.now(), parentId: e.parentAgentId ?? null }), piece })
  if (runId !== 'adhoc') logWire(wireLog, { from: 'lead', to: party(role, piece), kind: 'task', summary: taskLine(e.prompt) || role, at: Date.now(), via: 'sub' })
  const rec = { at: new Date().toISOString(), role, model: res.model, effort: d.effort, reason: d.reason, asked: e.model ?? null, agentId: res.agentId ?? null }
  decisions.push(rec)
  run.log.push(JSON.stringify(rec))
  await writeRunFile($, runId, 'routing.jsonl', run.log.join('\n') + '\n')
  if (d.reason !== 'table') $.ui.toast('agt ↑ ' + role + ' → ' + short(res.model) + ' · ' + d.effort + ' — ' + d.reason)
  $.ui.invalidate('ui.render')
  return res
}
