// agentille routing mod — enforces model + effort for agentille:agentille-* dispatches.
// Policy lives in routing.js; this file only observes events and applies decisions.
// Other plugins' agents and built-in agents are never touched.

import { DEFAULTS, decide, parseHeader, roleOf, verdictOf } from './routing.js'

const SAFE_RUN = /^[A-Za-z0-9_-]{1,64}$/

let settings = { ...DEFAULTS }
let depth = null
let home = null
let weeklyPct = null
const runs = new Map()   // run id → { revise, fixes, fable, log: [] }
const agents = new Map() // agentId → { run, role, effort }
const decisions = []     // this session, for /agt-routing

function runState(id) {
  if (!runs.has(id)) runs.set(id, { revise: 0, fixes: 0, fable: 0, log: [] })
  return runs.get(id)
}

async function loadProfile($) {
  home = (await $.env.get('HOME')) ?? null
  if (!home) return
  try {
    const p = JSON.parse(await $.fs.read(home + '/.agentille/profile.json'))
    depth = p.thinkingDepth ?? null
    settings = { ...DEFAULTS, ...(p.routing ?? {}) }
  } catch {
    // no profile yet: /agt itself tells the user to run /agentille-init
  }
}

async function persist($, runId, run, rec) {
  run.log.push(JSON.stringify(rec))
  if (!home || !SAFE_RUN.test(runId)) return
  try {
    await $.fs.write(home + '/.agentille/state/run-' + runId + '/routing.jsonl', run.log.join('\n') + '\n')
  } catch {
    // the run dir is the orchestrator's; logging never blocks a dispatch
  }
}

export function register(on) {
  on('session.start', async ($, e, next) => {
    await loadProfile($)
    await $.command.register({ name: 'agt-routing', description: 'Show the model + effort agentille picked for each agent this session', immediate: true })
    return next(e)
  })

  on('command.run', { command: 'agt-routing' }, async () => {
    if (decisions.length === 0) return { text: 'No agentille dispatches this session.' }
    return { text: decisions.slice(-30).map((d) => d.role + ' → ' + d.model + ' · ' + d.effort + (d.reason === 'table' ? '' : '  (' + d.reason + ')')).join('\n') }
  })

  on('session.measure', async ($, e, next) => {
    const week = e.rateLimits.find((r) => r.kind === 'seven_day')
    if (week) weeklyPct = week.percentUsed
    return next(e)
  })

  on('agent.spawn', async ($, e, next) => {
    const role = roleOf(e.subagentType)
    if (!role || e.fork) return next(e)

    const hdr = parseHeader(e.prompt) ?? {}
    const runId = SAFE_RUN.test(hdr.run ?? '') ? hdr.run : 'adhoc'
    const run = runState(runId)
    if (role === 'executor' && hdr.mode === 'fix') run.fixes += 1
    const shared = Number((await $.store.get('fable:' + runId)) ?? 0)
    run.fable = Math.max(run.fable, shared)

    const d = decide({ role, hdr, run, depth, settings, weeklyPct })
    const res = await next({ ...e, model: d.model })
    if (res.deny) return res

    if (d.fable) {
      run.fable += 1
      await $.store.set('fable:' + runId, run.fable)
    }
    if (res.agentId) agents.set(res.agentId, { run: runId, role, effort: d.effort })
    const rec = { at: new Date().toISOString(), role, model: res.model, effort: d.effort, reason: d.reason, asked: e.model ?? null, agentId: res.agentId ?? null }
    decisions.push(rec)
    await persist($, runId, run, rec)
    if (d.reason !== 'table') $.ui.toast('agt ↑ ' + role + ' → ' + d.model + ' · ' + d.effort + ' — ' + d.reason)
    return res
  })

  on('turn.step', async function* ($, e, next) {
    const a = e.agentId ? agents.get(e.agentId) : undefined
    return yield* next(a ? { ...e, effort: a.effort } : e)
  })

  on('turn.complete', async ($, e, next) => {
    const a = e.agentId ? agents.get(e.agentId) : undefined
    if (a && a.role === 'plan-reviewer' && verdictOf(e.answer) === 'REVISE') runState(a.run).revise += 1
    return next(e)
  })
}
