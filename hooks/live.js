// What is running right now: in-process subagents and herdr agt-* panes.
// Pure state + formatting; register.js feeds it events and draws the result.

import { modelKey } from './sprites.js'

export const DONE_GRACE_MS = 90_000
export const IDLE_GRACE_MS = 300_000
export const FAREWELL_TICKS = 4 // × the 600 ms redraw ticker ≈ 2.4 s
export const ON_STAGE = new Set(['working', 'blocked'])
const LEAVING = new Set(['done', 'idle'])
const EFFORT_BAR = { low: '▂', medium: '▄', high: '▆', xhigh: '▇', max: '█' }

export function newAgent({ id, role, routed, model, effort, reason, run, now }) {
  return { id, kind: 'sub', role, routed, model, effort, reason, run, start: now, end: null, state: 'working', input: 0, output: 0, cacheRead: 0, bye: 0 }
}

export function addUsage(a, u) {
  if (!a || !u) return
  a.input += (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0)
  a.output += u.output_tokens ?? 0
  a.cacheRead += u.cache_read_input_tokens ?? 0
}

export function finish(a, now, ms) {
  if (!a) return
  if (a.state !== 'done') a.bye = FAREWELL_TICKS
  a.state = 'done'
  a.end = ms != null ? a.start + ms : now
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

// Remembers when each pane entered its current state (by state_change_seq) and returns
// the panes that sat in done ≥ 90s or idle ≥ 300s. Only agt-* panes ever reach here.
export function reapable(panes, seen, now) {
  const out = []
  for (const p of panes) {
    const key = p.id
    const prev = seen.get(key)
    if (!prev || prev.seq !== p.seq || prev.state !== p.state) seen.set(key, { seq: p.seq, state: p.state, since: now })
    const since = seen.get(key).since
    if (p.state === 'done' && now - since >= DONE_GRACE_MS) out.push(p)
    else if (p.state === 'idle' && now - since >= IDLE_GRACE_MS) out.push(p)
  }
  for (const key of [...seen.keys()]) if (!panes.some((p) => p.id === key)) seen.delete(key)
  return out
}

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

// Rows to show: the latest run's subagents (working first), then live panes. Done
// subagents stay visible for 10 minutes so the band reads as a record, not a flicker.
export function visible(agents, panes, now) {
  const subs = [...agents.values()]
  const latest = subs.reduce((m, a) => (a.start > (m?.start ?? -1) ? a : m), null)
  const run = latest?.run
  const keep = subs.filter((a) => a.run === run && (a.state === 'working' || now - (a.end ?? now) < 600_000))
  keep.sort((a, b) => (a.state === b.state ? a.start - b.start : a.state === 'working' ? -1 : 1))
  return [...keep, ...panes]
}

export function summary(rows) {
  const working = rows.filter((r) => r.state === 'working').length
  const done = rows.filter((r) => r.state === 'done').length
  const tok = rows.reduce((s, r) => s + (r.input ?? 0) + (r.output ?? 0), 0)
  return { working, done, tok }
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

// ── stage: who is on screen, who is waving goodbye ───────────────────────────

export function newTracker() {
  return { staged: new Map(), byes: new Map() }
}

// Names that started a farewell this call. A pane leaves the stage by finishing,
// idling or vanishing; unknown/open panes are unreadable, so they keep their slot.
export function paneByes(tracker, next) {
  const out = []
  for (const [name, last] of [...tracker.staged]) {
    const q = next.find((p) => p.name === name)
    if (q && !LEAVING.has(q.state)) continue
    tracker.staged.delete(name)
    tracker.byes.set(name, { pane: { ...(q ?? last), state: 'done' }, bye: FAREWELL_TICKS })
    out.push(name)
  }
  for (const q of next) {
    if (!ON_STAGE.has(q.state)) continue
    tracker.staged.set(q.name, q)
    tracker.byes.delete(q.name)
  }
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

export function stage({ agents, panes = [], routes = [], tracker = newTracker(), run }) {
  const subs = [...agents.values()].filter((a) => a.run === run)
  const working = subs.filter((a) => a.state === 'working').sort((a, b) => a.start - b.start)
  const rows = [
    ...working,
    ...panes.filter((p) => ON_STAGE.has(p.state)).map((p) => ({ ...withRoute(p, routes), bye: 0 })),
    ...subs.filter((a) => a.state === 'done' && a.bye > 0),
    ...[...tracker.byes.values()].filter((b) => b.bye > 0).map((b) => ({ ...withRoute(b.pane, routes), bye: b.bye })),
  ]
  const tally = {
    working: working.length + panes.filter((p) => p.state === 'working').length,
    done: subs.filter((a) => a.state === 'done').length + routes.filter((r) => r.run === run && r.end != null).length,
    tok: subs.reduce((s, a) => s + a.input + a.output, 0),
  }
  return { rows, tally }
}

export function playing({ agents, tracker }) {
  return [...agents.values()].some((a) => a.bye > 0) || [...tracker.byes.values()].some((b) => b.bye > 0)
}

export function ageFarewells({ agents, tracker }) {
  for (const a of agents.values()) if (a.bye > 0) a.bye -= 1
  for (const [name, b] of [...tracker.byes]) {
    if (b.bye > 0) b.bye -= 1
    if (b.bye <= 0) tracker.byes.delete(name)
  }
  return playing({ agents, tracker })
}

export function stripText({ run, tally, waiting }) {
  if (waiting) return 'agentille · waiting for agents…'
  if (tally.done > 0) return `agentille · run ${run} · ${tally.done} done · /agt-ledger`
  return 'No agents yet. Run /agt and they show up here.'
}

// ── deck auto-open policy ─────────────────────────────────────────────────────

// A typed /agt run (bare or plugin-qualified), never /agt-deck, /agt-ledger, …
export function isAgtPrompt(text) {
  return /^\s*\/(agentille:)?agt(\s|$)/.test(String(text ?? ''))
}

// Open the deck unasked? Only with auto on, not already open, and not after the
// person closed it by hand during this same run.
export function shouldAutoOpen({ auto, open, dismissedRun, run }) {
  return auto !== false && !open && dismissedRun !== run
}

// Claude Code seats a pane only at any width when it answers the person's own prompt;
// opened from a spawn it needs 144 columns. So the deck opens on the typed /agt as a
// waiting strip. A turn that ends with no agent closes the strip, unless it ended on a
// question: the person's reply (another asked prompt) reopens it.
export const WAIT_TTL_MS = 30 * 60_000

export function endsOnQuestion(answer) {
  return /\?\s*(\*|`|_)*\s*$/.test(String(answer ?? '').trim().slice(-400))
}

export function reopenOnReply({ waiting, now }) {
  return !!waiting && now - waiting.at < WAIT_TTL_MS
}
