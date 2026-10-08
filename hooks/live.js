// What is running right now: in-process subagents and herdr agt-* panes.
// Pure state + formatting; register.js feeds it events and draws the result.

import { BYE_MS, modelKey } from './mascot.js'

export const DONE_GRACE_MS = 90_000
export const IDLE_GRACE_MS = 300_000
export const ON_STAGE = new Set(['working', 'blocked'])
const LEAVING = new Set(['done', 'idle'])
const EFFORT_BAR = { low: '▂', medium: '▄', high: '▆', xhigh: '▇', max: '█' }

export function newAgent({ id, role, routed, model, effort, reason, run, now, parentId = null }) {
  return { id, kind: 'sub', role, routed, model, effort, reason, run, parentId, listStatus: null, start: now, end: null, leftAt: null, state: 'working', input: 0, output: 0, cacheRead: 0 }
}

export function addUsage(a, u) {
  if (!a || !u) return
  a.input += (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0)
  a.output += u.output_tokens ?? 0
  a.cacheRead += u.cache_read_input_tokens ?? 0
}

export function finish(a, now, ms) {
  if (!a) return
  a.state = 'done'
  a.end = ms != null ? a.start + ms : now
  a.leftAt = now
}

// herdr `agent list` rows → pane agents; `name` = agt-<run>-<role…>
export function paneAgents(list, selfPane) {
  return (list ?? [])
    .filter((p) => typeof p.name === 'string' && p.name.startsWith('agt-') && p.pane_id !== selfPane)
    .map((p) => {
      const parts = p.name.split('-')
      return { id: p.pane_id, kind: 'pane', name: p.name, role: parts.slice(2).join('-') || p.name, run: parts[1] ?? '', vendor: p.agent ?? 'agent', state: p.agent_status ?? 'unknown', seq: p.state_change_seq ?? 0, tab: p.tab_id ?? null, workspace: p.workspace_id ?? null }
    })
}

// Remembers when each pane entered its current state (by state_change_seq) and sorts the panes
// that sat in done ≥ 90s, or in idle ≥ 300s while the lead has no turn running (an idle worker
// mid-run is waiting for review, not abandoned). A due pane is only `reap` once `harvested(pane)`
// says its answer is in hand; otherwise it is `stranded`: kept open and flagged, since closing
// it would lose the output. With no `harvested` nothing is ever reaped. Only agt-* panes reach here.
export function reapPlan(panes, seen, now, leadBusy = true, harvested = () => false) {
  const reap = []
  const stranded = []
  for (const p of panes) {
    const key = p.id
    const prev = seen.get(key)
    if (!prev || prev.seq !== p.seq || prev.state !== p.state) seen.set(key, { seq: p.seq, state: p.state, since: now })
    const since = seen.get(key).since
    const due = (p.state === 'done' && now - since >= DONE_GRACE_MS) || (p.state === 'idle' && !leadBusy && now - since >= IDLE_GRACE_MS)
    if (due) (harvested(p) ? reap : stranded).push(p)
  }
  for (const key of [...seen.keys()]) if (!panes.some((p) => p.id === key)) seen.delete(key)
  return { reap, stranded }
}

export const reapable = (panes, seen, now, leadBusy = true, harvested = () => false) => reapPlan(panes, seen, now, leadBusy, harvested).reap

export function short(model) {
  return modelKey(model)
}

export function tokens(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k'
  return String(n)
}

export function elapsed(ms) {
  const s = Math.max(0, Math.round(ms / 1000))
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0')
}

export function effortBar(effort) {
  return EFFORT_BAR[effort] ?? ' '
}

export function ledger(agents, run, routes = []) {
  const roles = {}
  const panes = {}
  const total = { agents: 0, input: 0, output: 0, cacheRead: 0, ms: 0 }
  for (const a of agents.values()) {
    if (a.run !== run) continue
    const r = (roles[a.role] ??= { agents: 0, input: 0, output: 0, cacheRead: 0, ms: 0 })
    const ms = (a.end ?? a.start) - a.start
    for (const t of [r, total]) {
      t.agents += 1; t.input += a.input; t.output += a.output; t.cacheRead += a.cacheRead; t.ms += ms
    }
  }
  for (const r of routes) {
    if (r.run !== run) continue
    const t = (panes[r.agent ?? r.role] ??= { agents: 0, ms: 0 })
    t.agents += 1
    t.ms += (r.end ?? r.start) - r.start
  }
  return { run, roles, total, panes }
}

export function ledgerText(l) {
  const names = Object.keys(l.roles)
  const panes = l.panes ?? {}
  const paneNames = Object.keys(panes)
  if (names.length === 0 && paneNames.length === 0) return 'No agents in this run yet.'
  const line = (name, t) => name.padEnd(20) + String(t.agents).padStart(3) + '  in ' + tokens(t.input).padStart(7) + '  out ' + tokens(t.output).padStart(7) + '  cache ' + tokens(t.cacheRead).padStart(7) + '  ' + elapsed(t.ms)
  const paneLine = (name, t) => (name + ' (pane)').padEnd(20) + String(t.agents).padStart(3) + '  tokens n/a  ' + elapsed(t.ms)
  return ['run ' + l.run, ...names.sort().map((n) => line(n, l.roles[n])), ...paneNames.sort().map((n) => paneLine(n, panes[n])), line('total', l.total)].join('\n')
}

// ── stage: who is on screen ──────────────────────────────────────────────────

// Names of the panes that left the stage this call: they finished, went idle or vanished.
// Unknown/open panes are unreadable, so they keep their slot. `staged` maps name → last pane.
export function panesLeft(staged, next) {
  const out = []
  for (const [name, last] of [...staged]) {
    const q = next.find((p) => p.name === name)
    if (q && !LEAVING.has(q.state)) continue
    staged.delete(name)
    out.push(name)
  }
  for (const q of next) if (ON_STAGE.has(q.state)) staged.set(q.name, q)
  return out
}

function newestRoute(routes, name, open = false) {
  for (let i = routes.length - 1; i >= 0; i--) {
    const r = routes[i]
    if (r.name === name && (!open || r.end == null)) return r
  }
  return null
}

export function withRoute(pane, routes = []) {
  const r = newestRoute(routes, pane.name)
  return { ...pane, agent: r?.agent ?? null, model: r?.model ?? null, effort: r?.effort ?? null, reason: r?.reason ?? null, start: r?.start ?? null }
}

export function endRoute(routes, name, now) {
  const r = newestRoute(routes, name, true)
  if (!r) return null
  r.end = now
  return r
}

// With `now`, a subagent that finished less than BYE_MS ago stays on stage to wave bye.
// leftAt is wall time; end can sit earlier when the harness reports a shorter duration.
export function waving(a, now) {
  return now != null && a.state === 'done' && a.leftAt != null && now - a.leftAt < BYE_MS
}

export function stage({ agents, panes = [], routes = [], run, now = null }) {
  const subs = [...agents.values()].filter((a) => a.run === run)
  const working = subs.filter((a) => a.state === 'working').sort((a, b) => a.start - b.start)
  const byes = subs.filter((a) => waving(a, now)).sort((a, b) => a.start - b.start)
  const rows = [...working, ...byes, ...panes.filter((p) => ON_STAGE.has(p.state)).map((p) => withRoute(p, routes))]
  const tally = {
    working: working.length + panes.filter((p) => p.state === 'working').length,
    done: subs.filter((a) => a.state === 'done').length + routes.filter((r) => r.run === run && r.end != null).length,
    tok: subs.reduce((s, a) => s + a.input + a.output, 0),
  }
  return { rows, tally }
}

// A typed /agt run (bare or plugin-qualified), never /agt-ledger, …
export function isAgtPrompt(text) {
  return /^\s*\/(agentille:)?agt(\s|$)/.test(String(text ?? ''))
}
