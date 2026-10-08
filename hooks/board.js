// The switchboard: what the band above the prompt shows, as plain data. Pure on purpose:
// register.js resolves the elements and paints; this file picks rows, glyphs and columns.

import { MODEL_COLOR, modelKey } from './mascot.js'
import { effortBar, elapsed, tokens } from './live.js'

export const SPIN = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'
export const KIND_GLYPH = { sub: '◇', pane: '▣' }
export const DONE_GLYPH = '✓'
export const ACCENT = 0xd97757
export const FRAME_COLOR = 0x3d4250
export const DONE_COLOR = 0x3fb950
export const WIRE_COLOR = 0x56d4dd
export const WIRE_SHOW_MS = 120_000

export const INK = '#14161c'
export const hex = (n) => '#' + n.toString(16).padStart(6, '0')
export const colorOf = (model) => hex(MODEL_COLOR[modelKey(model)])

// One braille frame per tick; each row starts at its own offset so the spinners don't march in step.
export function spin(tick, offset = 0) {
  return SPIN[(tick + offset * 3) % SPIN.length]
}

// "claude-opus-5-5" → "opus 5.5", "claude-haiku-4-5-20251001" → "haiku 4.5", "sonnet" → "sonnet".
export function prettyModel(model) {
  const m = String(model ?? '').toLowerCase()
  const k = modelKey(m)
  if (k === 'other') return m.replace(/^claude-/, '').slice(0, 14) || 'model'
  const v = new RegExp(k + '-(\\d+)(?:-(\\d{1,2}))?(?!\\d)').exec(m)
  return v ? k + ' ' + v[1] + (v[2] ? '.' + v[2] : '') : k
}

// The model pill's text, one width for every model so the columns line up.
export const CHIP_WIDTH = 8
export function chip(model) {
  const k = modelKey(model)
  const name = k === 'other' ? String(model ?? '?').replace(/^claude-/, '').slice(0, CHIP_WIDTH - 2) : k
  const pad = CHIP_WIDTH - name.length
  return ' '.repeat(Math.floor(pad / 2)) + name + ' '.repeat(Math.ceil(pad / 2))
}

const base = (p) => String(p ?? '').split('/').filter(Boolean).pop() ?? ''
const cut = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s)

// What an agent is doing, from its latest tool call: "Edit Paywall.swift", "Bash npm test".
export function toolLabel(tool, input = {}) {
  const t = String(tool ?? '')
  const i = input ?? {}
  if (['Read', 'Edit', 'Write', 'NotebookEdit'].includes(t)) return t + ' ' + base(i.file_path ?? i.notebook_path)
  if (t === 'Bash') return 'Bash ' + cut(String(i.command ?? '').trim().split(/\s+/).slice(0, 3).join(' '), 28)
  if (t === 'Grep' || t === 'Glob') return t + ' ' + cut(String(i.pattern ?? ''), 24)
  if (t === 'WebFetch') return 'Fetch ' + (/^https?:\/\/([^/]+)/.exec(String(i.url ?? ''))?.[1] ?? '')
  if (t === 'WebSearch') return 'Search ' + cut(String(i.query ?? ''), 24)
  if (t === 'Agent') return 'Agent ' + cut(String(i.description ?? i.subagent_type ?? ''), 24)
  if (t === 'Skill') return 'Skill ' + String(i.skill ?? '')
  if (t === 'TodoWrite') return 'Plan'
  if (t.startsWith('mcp__')) return t.split('__').slice(2).join(' ')
  return t
}

// Which columns fit in `cols` cells of band body.
export function columns(cols) {
  const c = Number(cols) || 80
  return { kind: c >= 92, effort: c >= 78, tok: c >= 68, role: c >= 88 ? 16 : 12 }
}

// The run's cast in dispatch order. While anything still works, finished subagents of the run
// stay as dim ✓ rows so the tree reads as the run's history; otherwise `stage` decides.
export function cast(staged, agents, run) {
  const rows = [...staged.rows]
  if (staged.tally.working > 0) {
    for (const a of agents.values()) if (a.run === run && a.state === 'done' && !rows.includes(a)) rows.push(a)
  }
  const at = (r) => (typeof r.start === 'number' ? r.start : Infinity)
  return rows.sort((a, b) => at(a) - at(b))
}

const BUSY = new Set(['working'])

// How the engine's agent list reads on a row. waiting and idle replace the spinner of a working
// agent; failed and killed replace the done mark of a finished one.
export const LIST_STATUS = {
  waiting: { glyph: '⏸', word: 'waiting', color: 'warning' },
  idle: { glyph: '·', word: 'idle', color: 'inactive' },
  failed: { glyph: '✗', word: 'failed', color: 'error' },
  killed: { glyph: '✗', word: 'killed', color: 'error' },
}
const BROKEN = new Set(['failed', 'killed'])
// A workflow agent's reason: plain `workflow` when the script ran the table's model, `workflow, table says X · Y`
// when it did not. Neither is an escalation; the drift reads `≠`, not `↑`.
const isWorkflow = (reason) => typeof reason === 'string' && reason.startsWith('workflow')
const isDrift = (reason) => isWorkflow(reason) && reason !== 'workflow'
const escalation = (reason) => !!reason && reason !== 'table' && !isWorkflow(reason)

// One band row per agent. `wire` maps a pane name to what its worker published (tool, tok, model).
// `view` is the id of the agent whose transcript is on screen.
export function boardRows(rows, { now, tick = 0, cols = 80, wire = new Map(), transport = 'pane', view = null } = {}) {
  const c = columns(cols)
  return rows.map((r, i) => {
    const pub = r.kind === 'pane' ? wire.get(r.name) ?? null : null
    const model = r.model ?? pub?.model ?? null
    const busy = BUSY.has(r.state)
    const done = r.kind === 'sub' ? r.state === 'done' : r.state === 'done' || r.state === 'idle'
    const ls = r.kind === 'sub' ? LIST_STATUS[r.listStatus] : undefined
    const broken = done && !!ls && BROKEN.has(r.listStatus)
    const paused = !done && !!ls && !BROKEN.has(r.listStatus)
    const tool = r.tool ?? pub?.tool ?? null
    const tok = r.kind === 'sub' ? r.input + r.output : pub?.tok ?? null
    const start = r.start ?? pub?.start ?? null
    const kind = r.kind !== 'pane' ? 'sub' : r.vendor && r.vendor !== 'claude' && r.vendor !== 'agent' ? r.vendor : transport
    let activity
    if (r.state === 'blocked') activity = '⚑ waiting on you'
    else if (broken || paused) activity = ls.word
    else if (done) activity = r.kind === 'sub' ? 'done' : r.state
    else if (r.state === 'open') activity = 'open'
    else activity = tool ?? (escalation(r.reason) ? '↑ ' + r.reason : isDrift(r.reason) ? '≠ ' + r.reason : r.kind === 'pane' ? 'working' : 'thinking')
    return {
      id: r.id,
      name: r.name ?? null,
      pane: r.kind === 'pane',
      tree: r.tree ?? (i === rows.length - 1 ? '└─' : '├─'),
      inView: view != null && r.id === view,
      glyph: broken ? ls.glyph : done ? DONE_GLYPH : KIND_GLYPH[r.kind] ?? '·',
      glyphColor: broken || paused ? ls.color : done ? hex(DONE_COLOR) : colorOf(model),
      role: cut(String(r.role ?? '?'), c.role).padEnd(c.role),
      kind: c.kind ? String(kind).slice(0, 5).padEnd(5) : null,
      chip: model ? chip(model) : chip(r.kind === 'sub' ? '?' : r.vendor ?? 'pane'),
      chipColor: colorOf(model),
      effort: c.effort ? (effortBar(r.effort) + ' ' + String(r.effort ?? '').slice(0, 4)).padEnd(6) : null,
      spinner: paused ? ls.glyph : busy ? spin(tick, i) : done ? ' ' : '·',
      activity,
      escalated: escalation(r.reason),
      reason: r.reason && r.reason !== 'table' && r.reason !== 'workflow' ? r.reason : null,
      time: start != null && !r.adopted ? elapsed((r.end ?? now) - start).padStart(5) : '     ',
      tok: c.tok ? (tok != null && !r.adopted ? tokens(tok) : '').padStart(6) : null,
      dim: done && !broken,
      busy,
    }
  })
}

// "◆ agentille · run r1 · gauntlet" on the left, "◇2 ▣1 · 50.3k" on the right.
export function header({ run, formation = null, squads = [], rows = [], tally }) {
  const left = ['run ' + run]
  if (formation) left.push(formation)
  if (squads.length) left.push(squads.join('+'))
  const subs = rows.filter((r) => r.kind === 'sub' && r.state === 'working').length
  const panes = rows.filter((r) => r.kind === 'pane' && r.state !== 'done' && r.state !== 'idle').length
  const right = [KIND_GLYPH.sub + subs + ' ' + KIND_GLYPH.pane + panes]
  if (tally.tok) right.push(tokens(tally.tok))
  return { left: left.join(' · '), right: right.join(' · ') }
}

// The tree's root: the lead session itself.
export function leadLine({ model, busy, waiting }) {
  const what = busy ? 'orchestrating' : waiting > 0 ? 'waiting on ' + waiting : 'idle'
  return { text: 'lead · ' + prettyModel(model ?? 'opus'), state: what, color: colorOf(model ?? 'opus') }
}

// The newest wire message worth a row: ⇄ exec-1 → lead "slice built" 12s.
export function wireRow(log, now) {
  const m = log[log.length - 1]
  if (!m || now - m.at > WIRE_SHOW_MS) return null
  const ago = Math.max(0, Math.round((now - m.at) / 1000))
  return { arrow: m.from + ' → ' + m.to, text: '"' + cut(m.summary, 60) + '"', ago: ago < 60 ? ago + 's' : Math.floor(ago / 60) + 'm' }
}

// ── the deck: the optional /agt-deck pane ─────────────────────────────────────

export const CAST_WIDTH = 14

// Mascots side by side, as many as fit `cols`: each a column of five lines (three of mascot,
// role, model). `frameOf(mood, tick, role)` is mascot.js frame; `moodOf(row)` its mood.
export function castColumns(rows, { cols, tick = 0, frameOf, moodOf }) {
  const fit = Math.max(1, Math.floor((Number(cols) || 80) / CAST_WIDTH))
  const shown = rows.slice(0, fit)
  return {
    cells: shown.map((r) => {
      const mood = moodOf(r)
      const [head, body, legs] = frameOf(mood, tick, r.kind === 'sub' ? r.role : 'executor')
      return { lines: [head, body, legs].map((l) => l.padEnd(CAST_WIDTH)), role: cut(String(r.role ?? '?'), CAST_WIDTH - 4), model: r.model ?? null, glyph: r.state === 'done' ? DONE_GLYPH : KIND_GLYPH[r.kind] ?? '·', dim: r.state === 'done' || r.state === 'idle' }
    }),
    more: rows.length - shown.length,
  }
}

const clock = (iso) => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '--:--:--' : d.toTimeString().slice(0, 8)
}

// The routing timeline, newest last: "12:10:04  planner → opus · high  table".
export function routingLines(decisions, n = 8) {
  return decisions.slice(-n).map((d) => ({
    at: clock(d.at),
    who: cut(String(d.role), 16).padEnd(16) + (d.kind === 'pane' ? ' ▣' : ' ◇'),
    route: (prettyModel(d.model) + ' · ' + (d.effort ?? '')).padEnd(21),
    color: colorOf(d.model),
    reason: escalation(d.reason) ? '↑ ' + d.reason : isDrift(d.reason) ? '≠ ' + d.reason : d.reason === 'workflow' ? 'workflow' : 'table',
    escalated: escalation(d.reason),
    drift: isDrift(d.reason),
  }))
}

// The wire log, newest last: "12:12:01  exec-1 → lead  done  slice 1 built".
export function wireLines(log, n = 6) {
  return log.slice(-n).map((m) => ({ at: clock(new Date(m.at).toISOString()), arrow: (m.from + ' → ' + m.to).padEnd(18), kind: m.kind.padEnd(5), text: cut(m.summary, 70) }))
}

// Token bars per role from a ledger (live.js), widest first.
export function tokenBars(l, width = 20) {
  const roles = Object.entries(l?.roles ?? {}).map(([name, t]) => ({ name, tok: t.input + t.output }))
  const top = Math.max(1, ...roles.map((r) => r.tok))
  return roles.sort((a, b) => b.tok - a.tok).slice(0, 8).map((r) => {
    const fill = Math.max(r.tok > 0 ? 1 : 0, Math.round((r.tok / top) * width))
    return { name: cut(r.name, 16).padEnd(16), bar: '█'.repeat(fill) + '░'.repeat(width - fill), tok: tokens(r.tok).padStart(6) }
  })
}

// ── the swarm line: the whole run in one line, by phase ──────────────────────

export const PHASES = ['plan', 'build', 'review', 'other']
const LANE_CAP = 8 // cells per lane before it reads "+n"

export function phaseOf(role) {
  const r = String(role ?? '')
  if (r === 'planner' || r === 'plan-reviewer' || r === 'ui-prototyper') return 'plan'
  if (r === 'executor' || r === 'adversary') return 'build'
  if (r.endsWith('-reviewer')) return 'review'
  return 'other'
}

// One cell per agent of the run, done ones included, so a run of twelve reads in one line where
// the tree only has room for a few rows. A working cell pulses (◆/◇, ▣/□) on the ticker, offset
// per cell; a finished one is a dim ✓, a failed or killed one ✗. Pane workers come from their
// routes (one per spawn), working until the route ends. Undefined below three agents (the tree
// already shows that many) and outside an /agt run (`adhoc` is every plain subagent of the session).
// A lane past LANE_CAP keeps every working and failed cell and fills the rest with the newest
// finished ones, in start order: the live agent is never the one cut.
export function swarm({ agents, routes = [], run, tick = 0 }) {
  if (run === 'adhoc') return undefined
  const cells = []
  for (const a of agents.values()) {
    if (a.run !== run) continue
    const broken = BROKEN.has(a.listStatus)
    const working = a.state === 'working' && !broken
    cells.push({ at: a.start ?? 0, phase: phaseOf(a.role), kind: 'sub', working, broken, model: a.model })
  }
  for (const r of routes) {
    if (r.run !== run) continue
    cells.push({ at: r.start ?? 0, phase: phaseOf(r.agent ?? r.role), kind: 'pane', working: r.end == null, broken: false, model: r.model })
  }
  if (cells.length < 3) return undefined
  cells.sort((a, b) => a.at - b.at)
  const lanes = []
  for (const phase of PHASES) {
    const mine = cells.filter((c) => c.phase === phase)
    if (!mine.length) continue
    const keep = new Set(mine.filter((c) => c.working || c.broken).slice(-LANE_CAP))
    for (let i = mine.length - 1; i >= 0 && keep.size < LANE_CAP; i--) keep.add(mine[i])
    const shown = mine.filter((c) => keep.has(c)).map((c, i) => {
      if (c.broken) return { glyph: '✗', color: 'error', dim: false }
      if (!c.working) return { glyph: DONE_GLYPH, color: hex(DONE_COLOR), dim: true }
      const on = (tick + i) % 4 < 2
      return { glyph: c.kind === 'pane' ? (on ? '▣' : '□') : on ? '◆' : '◇', color: colorOf(c.model), dim: false }
    })
    lanes.push({ phase, cells: shown, more: mine.length - shown.length })
  }
  return { lanes, done: cells.filter((c) => !c.working).length, total: cells.length }
}
