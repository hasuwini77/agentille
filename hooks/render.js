// agentille drawing: the switchboard above the prompt, the deck pane, the answer frame and the worker's mascot
// band, built from the surface's own elements (`els`) and the state. Nothing here changes state; the one call
// out is the ↗ button's jump to a pane.

import { S, isLead, Timers, Wire } from './state.js'
import { ACCENT, FRAME_COLOR, DONE_COLOR, WIRE_COLOR, INK, hex, colorOf, chip, cast, boardRows, header, leadLine, wireRow, castColumns, routingLines, wireLines, tokenBars, swarm } from './board.js'
import { focusLines } from './display.js'
import { MARK, SPAN_COLOR, spans, bodyParts } from './highlight.js'
import { linkPieces, loopText } from './links.js'
import { ledger, stage } from './live.js'
import { MASCOT_COLOR, MODEL_COLOR, modelKey, frame, caption, moodAt, agentMood } from './mascot.js'
import { PROBE, focusArgv } from './panes.js'
import { nest } from './tree.js'

export const FOCUS_COLOR = { next: '#3fb950', flag: '#f85149' }

// One Text per essentials item: a coloured mark, then the line with paths, versions and numbers lit.
export function cardBox(els, items) {
  const { Box, Text } = els
  return Box({
    flexDirection: 'column',
    children: items.map((item) => {
      const color = FOCUS_COLOR[item.kind]
      return Text({
        ...(color ? { color } : { dimColor: true }),
        wrap: 'truncate',
        children: [
          Text({ ...(color ? { color } : { dimColor: true }), children: [MARK[item.kind] + ' '] }),
          ...spans(item.text).map((sp) => (sp.kind === 'plain' ? sp.text : Text({ color: SPAN_COLOR[sp.kind], children: [sp.text] }))),
        ],
      })
    }),
  })
}

// The final answer's frame: red for ✗, amber when the person has a move, green for a ✓ card, orange otherwise.
export const TONE_COLOR = { ok: DONE_COLOR, fail: 0xf85149, move: 0xf2a33a, flag: 0xf2a33a, plain: ACCENT }

export const MOVE_COLOR = 0xf2a33a

export const litText = (els, text, base) => spans(text).map((sp) => (sp.kind === 'plain' ? sp.text : els.Text({ color: SPAN_COLOR[sp.kind], children: [sp.text] })))

// A numbered or bulleted row whose wrapped lines stay right of the marker.
export const hangRow = (els, mark, width, color, text) => els.Box({ flexDirection: 'row', children: [
  els.Box({ width, flexShrink: 0, children: [els.Text({ color, children: [mark] })] }),
  els.Box({ flexGrow: 1, flexShrink: 1, children: [els.Text({ children: litText(els, text) })] }),
] })

// A rule across the rest of the row: a long run of ─ in a one-row box that clips it, so it reaches the
// edge without the "…" a truncated Text ends in. The label and the corner never shrink.
export const ruleRow = (els, color, label, corner) => els.Box({ flexDirection: 'row', children: [
  els.Box({ flexShrink: 0, children: [label] }),
  els.Box({ flexGrow: 1, flexShrink: 1, height: 1, overflow: 'hidden', children: [els.Text({ color, children: ['─'.repeat(400)] })] }),
  ...(corner ? [els.Box({ flexShrink: 0, children: [els.Text({ color, children: [corner] })] })] : []),
] })

// ╭─ ◆ agentille · time ─╮ over the answer, ╰─╯ under it, and nothing beside it: the text sits flush
// left, so a selection copies no border or indent. Inside: the headline, the essentials strip (unshaped
// answers only), the body with its top-level bullets as • rows, then the person's move under an amber
// "── your move ──" divider, numbered, or one dim line saying nothing is needed from them.
export function answerBox(els, p) {
  const { Box, Text, Markdown } = els
  const color = hex(TONE_COLOR[p.tone] ?? ACCENT)
  const kids = [ruleRow(els, color, Text({ children: [
    Text({ color, children: ['╭─ '] }), Text({ color, children: ['◆ '] }), Text({ color, children: ['agentille'] }),
    ...(p.time ? [Text({ dimColor: true, children: [' · ' + p.time] })] : []), Text({ color, children: [' '] }),
  ] }), '╮')]
  if (p.head) kids.push(Text({ color, children: litText(els, p.head) }))
  if (p.card.length) kids.push(Box({ marginTop: p.head ? 1 : 0, children: [cardBox(els, p.card)] }))
  for (const part of p.body ? bodyParts(p.body) : []) {
    const marginTop = kids.length > 1 ? 1 : 0
    kids.push(part.items
      ? Box({ marginTop, flexDirection: 'column', children: part.items.map((item) => hangRow(els, '•', 2, color, item)) })
      : Box({ marginTop, children: [Markdown({ text: part.text })] }))
  }
  if (p.move) {
    const amber = hex(MOVE_COLOR)
    const width = p.move.length > 9 ? 4 : 3
    kids.push(Box({
      marginTop: kids.length > 1 ? 1 : 0, flexDirection: 'column',
      children: [
        ruleRow(els, amber, Text({ color: amber, children: ['── your move '] })),
        ...p.move.map((step, i) => hangRow(els, p.move.length > 1 ? i + 1 + '.' : '→', width, amber, step)),
      ],
    }))
  } else if (p.idle) kids.push(Box({ marginTop: kids.length > 1 ? 1 : 0, children: [Text({ color: hex(DONE_COLOR), dimColor: true, children: ['✓ nothing needed from you'] })] }))
  kids.push(ruleRow(els, color, Text({ color, children: ['╰'] }), '╯'))
  return Box({ flexDirection: 'column', children: kids })
}

export const focusRow = (els, text) => els.Text({ color: FOCUS_COLOR.flag, wrap: 'truncate', children: ['⚑ ' + text] })

// ── the wire (worker side publishes and reports; lead side reads) ─────────────

export function boardHeader(els, h, version = null) {
  const { Box, Text } = els
  return Box({
    flexDirection: 'row',
    justifyContent: 'space-between',
    children: [
      Text({ wrap: 'truncate', children: [Text({ color: hex(ACCENT), children: ['◆ agentille'] }), Text({ dimColor: true, children: [(version ? ' v' + version : '') + '  ' + h.left] })] }),
      Text({ dimColor: true, children: [h.right] }),
    ],
  })
}

// The whole run in one line, by phase: plan ✓ · build ◆◇ · review ◆◆◆✓ · 3/7 done.
export function swarmLine(els, s) {
  const { Text } = els
  const parts = []
  s.lanes.forEach((l, i) => {
    parts.push(Text({ dimColor: true, children: [(i ? '  ' : '') + l.phase + ' '] }))
    for (const c of l.cells) parts.push(Text({ color: c.color, dimColor: c.dim, children: [c.glyph] }))
    if (l.more) parts.push(Text({ dimColor: true, children: ['+' + l.more] }))
  })
  parts.push(Text({ dimColor: true, children: ['  ' + s.done + '/' + s.total + ' done'] }))
  return Text({ wrap: 'truncate', children: parts })
}

export function leadRow(els, l) {
  const { Text } = els
  return Text({ wrap: 'truncate', children: [Text({ color: l.color, children: ['◉ '] }), l.text, Text({ dimColor: true, children: ['  ' + l.state] })] })
}

// One agent: tree · kind glyph · role · transport · model pill · effort · spinner + what it does ·
// elapsed · tokens, and a ↗ that jumps to a pane worker.
export function boardRow(els, r, onFocus, slot = false) {
  const { Box, Text, Button } = els
  const kids = [Text({ dimColor: true, children: [r.tree] }), Text({ color: r.glyphColor, children: [r.glyph] }), Text({ dimColor: r.dim, ...(r.inView ? { inverse: true } : {}), children: [r.role] })]
  if (r.kind) kids.push(Text({ dimColor: true, children: [r.kind] }))
  kids.push(r.dim ? Text({ color: r.chipColor, dimColor: true, children: [r.chip] }) : Text({ color: INK, backgroundColor: r.chipColor, children: [r.chip] }))
  kids.push(Text({ color: colorOf('fable'), children: [r.escalated ? '↑' : ' '] }))
  if (r.effort) kids.push(Text({ dimColor: true, children: [r.effort] }))
  const activity = r.verdict ? Text({ color: r.verdict, children: [r.activity] }) : r.activity
  kids.push(Box({ flexGrow: 1, flexShrink: 1, children: [Text({ wrap: 'truncate', dimColor: r.dim && !r.verdict, children: [Text({ color: r.glyphColor, children: [r.spinner + ' '] }), activity] })] }))
  kids.push(Text({ dimColor: true, children: [r.time] }))
  if (r.tok) kids.push(Text({ dimColor: true, children: [r.tok] }))
  if (onFocus) kids.push(Button({ key: 'focus:' + r.id, label: '↗', plain: true, dimColor: true, onPress: onFocus }))
  else if (slot) kids.push(Text({ children: [' '] })) // keeps the columns of rows without a ↗ in line
  return Box({ flexDirection: 'row', columnGap: 1, children: kids })
}

export function wireLine(els, w) {
  const { Text } = els
  return Text({ wrap: 'truncate', children: [Text({ color: hex(WIRE_COLOR), children: ['⇄ ' + w.arrow + '  '] }), w.text, Text({ dimColor: true, children: ['  ' + w.ago] })] })
}

export const rule = (els, label) => els.Text({ dimColor: true, children: ['── ' + label + ' ' + '─'.repeat(Math.max(0, 40 - label.length))] })

// A worker's own band: the mascot's three rows over a caption, or the caption alone when the
// band is short, off a terminal, or nothing is animating.
export function workerBand(els, e, now) {
  const { Box, Text } = els
  const mood = moodAt({ ...S.mascot, now })
  const cap = caption({ mood, ...S.worker, ms: mood === 'working' ? now - S.mascot.start : S.mascot.ms })
  const capText = Text({ color: hex(MODEL_COLOR[modelKey(S.worker.model)]), wrap: 'truncate', children: [cap] })
  if (mood === 'idle' || e.surface !== 'terminal' || (e.props.maxRows ?? 0) < 5) return [capText]
  const [head, body, legs] = frame(mood, Timers.tick >> 1, S.worker.agent)
  const orange = hex(MASCOT_COLOR)
  return [Text({ color: orange, children: [head] }), Text({ color: orange, children: [body] }), Box({ flexDirection: 'row', children: [Text({ color: orange, children: [legs + '   '] }), capText] })]
}

// The switchboard above the prompt: a framed dispatch tree rooted at the lead, one row per
// subagent (◇) and pane session (▣), the newest wire message, and any agent flags.
export async function switchboard($, e, next) {
  if (e.props.hasSurvey) return next(e)
  const now = Date.now()
  const scene = stage({ agents: S.live, panes: S.panes, routes: S.paneRoutes, run: S.lastRun, now })
  const focus = focusLines(now)
  const wire = wireRow(Wire.wireLog, now)
  if (scene.rows.length === 0 && isLead() && focus.length === 0 && !wire) return next(e)
  const els = $.ui.resolve(e)
  const kids = focus.map((l) => focusRow(els, l))
  if (S.worker) kids.push(...workerBand(els, e, await $.clock.now()))
  else if (S.selfName) kids.push(els.Text({ color: hex(MODEL_COLOR.opus), children: ['agentille worker · ' + S.selfName] }))
  const theirs = await next(e)
  // No agent rows: the newest wire message alone, no frame.
  if (scene.rows.length === 0) return els.Box({ flexDirection: 'column', children: [...kids, ...(wire ? [wireLine(els, wire)] : []), theirs] })

  const rows = nest(linkPieces(cast(scene, S.live, S.lastRun)))
  const cols = (e.props.bodyColumns ?? 80) - 4
  const view = boardRows(rows, { now, tick: Timers.tick, cols, wire: Wire.wireStatus, transport: S.transport, view: e.props.view?.agentId ?? null })
  const sw = swarm({ agents: S.live, routes: S.paneRoutes, run: S.lastRun, tick: Timers.tick })
  const room = Math.max(1, (e.props.maxRows ?? 10) - 4 - kids.length - (wire ? 1 : 0) - (sw ? 1 : 0))
  const waiting = rows.filter((r) => r.state === 'working').length
  const inner = [boardHeader(els, header({ run: S.lastRun, formation: S.runs.get(S.lastRun)?.formation, squads: S.squads.map((q) => q.name), loops: loopText(S.runs.get(S.lastRun)) }), S.runningVersion)]
  if (sw) inner.push(swarmLine(els, sw))
  if (rows.length) inner.push(leadRow(els, leadLine({ model: S.leadModel, busy: e.props.isWorking, waiting })))
  const shown = view.slice(0, room)
  const argvs = shown.map((r) => (r.pane ? focusArgv(S.transport, rows.find((x) => x.id === r.id)) : null))
  const slot = argvs.some(Boolean)
  shown.forEach((r, i) => inner.push(boardRow(els, r, argvs[i] ? () => { $.process.run(argvs[i], PROBE).catch(() => {}) } : null, slot)))
  if (view.length > room) inner.push(els.Text({ dimColor: true, children: ['   +' + (view.length - room) + ' more · /agt-deck'] }))
  if (wire) inner.push(wireLine(els, wire))
  const board = els.Box({ flexDirection: 'column', borderStyle: 'round', borderColor: hex(FRAME_COLOR), paddingX: 1, children: inner })
  return els.Box({ flexDirection: 'column', children: [...kids, board, theirs] })
}

// The deck: the whole run at a glance, drawn only while the person keeps it open.
export async function deck($, e) {
  const els = $.ui.resolve(e)
  const { Box, Text } = els
  const now = Date.now()
  const scene = stage({ agents: S.live, panes: S.panes, routes: S.paneRoutes, run: S.lastRun, now })
  const all = [...scene.rows, ...[...S.live.values()].filter((a) => a.run === S.lastRun && !scene.rows.includes(a))]
  const rows = cast({ rows: all.map((r) => (r.kind === 'pane' && !r.model ? { ...r, model: Wire.wireStatus.get(r.name)?.model ?? null } : r)), tally: { working: 0 } }, S.live, S.lastRun)
  const cols = e.props.bodyColumns ?? 80
  const kids = [boardHeader(els, header({ run: S.lastRun, formation: S.runs.get(S.lastRun)?.formation, squads: S.squads.map((q) => q.name), loops: loopText(S.runs.get(S.lastRun)) }), S.runningVersion)]
  if (rows.length === 0 && S.decisions.length === 0 && Wire.wireLog.length === 0) {
    kids.push(Text({ dimColor: true, children: ['No agents yet. Type /agt "task": every dispatch shows up here.'] }))
    return Box({ flexDirection: 'column', children: kids })
  }
  if (rows.length) {
    kids.push(rule(els, 'cast'))
    const c = castColumns(rows, { cols, tick: Timers.tick >> 1, frameOf: frame, moodOf: (r) => (r.kind === 'sub' ? agentMood(r, now) : r.state === 'working' ? 'working' : 'bye') })
    const orange = hex(MASCOT_COLOR)
    const line = (pick) => Box({ flexDirection: 'row', children: c.cells.map(pick) })
    for (const i of [0, 1, 2]) kids.push(line((m) => Text({ color: orange, dimColor: m.dim, children: [m.lines[i]] })))
    kids.push(line((m) => Text({ dimColor: m.dim, children: [(m.glyph + ' ' + m.role).padEnd(14)] })))
    kids.push(line((m) => Box({ width: 14, children: [m.model ? Text({ color: INK, backgroundColor: colorOf(m.model), children: [chip(m.model)] }) : Text({ dimColor: true, children: ['pane'] })] })))
    if (c.more > 0) kids.push(Text({ dimColor: true, children: ['+' + c.more + ' more'] }))
  }
  if (Wire.wireLog.length) {
    kids.push(rule(els, 'conversation'))
    for (const w of wireLines(Wire.wireLog)) kids.push(Text({ wrap: 'truncate', children: [Text({ dimColor: true, children: [w.at + '  '] }), Text({ color: w.sub ? undefined : hex(WIRE_COLOR), children: [w.arrow + ' '] }), Text({ dimColor: true, children: [w.kind + ' '] }), w.text] }))
  }
  if (S.decisions.length) {
    kids.push(rule(els, 'routing'))
    for (const d of routingLines(S.decisions)) kids.push(Text({ wrap: 'truncate', children: [Text({ dimColor: true, children: [d.at + '  '] }), d.who + '  ', Text({ color: d.color, children: [d.route] }), Text({ color: d.escalated ? colorOf('fable') : d.drift ? 'warning' : undefined, dimColor: !d.escalated && !d.drift, children: [d.reason] })] }))
  }
  const bars = tokenBars(ledger(S.live, S.lastRun, S.paneRoutes), Math.max(8, Math.min(30, cols - 30)))
  if (bars.length) {
    kids.push(rule(els, 'tokens'))
    for (const b of bars) kids.push(Text({ children: [b.name + ' ', Text({ color: hex(ACCENT), children: [b.bar] }), Text({ dimColor: true, children: [' ' + b.tok] })] }))
  }
  return Box({ flexDirection: 'column', children: kids })
}
