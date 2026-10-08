// Live agent rows in the transcript: an Agent tool call draws as the agent it started, with its
// model, effort, current tool, time and tokens, instead of the engine's static row.
// The live map (ctx.live) is the truth; this file only paints from it.

import { boardRows, prettyModel } from './board.js'
import { short, waving } from './live.js'

const MAX_CALLS = 200
const EFFORT_SHORT = { low: 'low', medium: 'med', high: 'high', xhigh: 'xhi', max: 'max' }

// One agent as plain row data: the board's glyph, colour, spinner and activity, in the
// transcript's column order. A model the mod never saw reads `?`; nothing is guessed.
export function agentRow(a, { now, tick = 0 } = {}) {
  const r = boardRows([a], { now, tick, cols: 200 })[0]
  const k = a.model == null ? '?' : short(a.model) === 'other' ? prettyModel(a.model) : short(a.model)
  return {
    glyph: r.glyph,
    glyphColor: r.glyphColor,
    role: String(a.role ?? '?').trim(),
    model: k + (a.effort ? '·' + (EFFORT_SHORT[a.effort] ?? String(a.effort).slice(0, 3)) : ''),
    modelColor: r.chipColor,
    spinner: r.spinner.trim(),
    activity: r.activity,
    time: r.time.trim(),
    tok: r.tok == null ? '' : r.tok.trim() + ' tok',
    dim: r.dim,
  }
}

// A finished agent's row no longer changes, so it is built once and reused by every redraw: the
// cache holds it per agent, under the fields it is built from (the list status can still move
// after the agent is done). A working agent, or one still waving goodbye, is built each time.
export function cachedRow(cache, a, { now, tick = 0 }) {
  if (a.state !== 'done' || waving(a, now)) return agentRow(a, { now, tick })
  const key = [a.state, a.input + a.output, a.listStatus, a.end].join('|')
  const hit = cache.get(a.id)
  if (hit?.key === key) return hit.row
  const row = agentRow(a, { now, tick })
  cache.delete(a.id)
  cache.set(a.id, { key, row })
  if (cache.size > MAX_CALLS) cache.delete(cache.keys().next().value)
  return row
}

export function registerRows(on, ctx) {
  const calls = new Map() // tool_use_id → agentId, for a call whose result has not landed yet
  const finished = new Map() // agentId → { key, row }, a finished agent's row (cachedRow)

  // Observe only: remember which agent a call started, since a running ToolUse has no output.
  // A matcher keeps this clear of register.js's own unmatched agent.spawn hook (the engine refuses two).
  // A workflow's agents all carry the Workflow call's id, which names none of them: not kept.
  on('agent.spawn', { subagentType: /./ }, async ($, e, next) => {
    const res = await next(e)
    if (e.tool_use_id && !e.workflow && res?.agentId) {
      calls.delete(e.tool_use_id)
      calls.set(e.tool_use_id, res.agentId)
      if (calls.size > MAX_CALLS) calls.delete(calls.keys().next().value)
    }
    return res
  })

  on('ui.render', { component: 'ToolUse', props: { tool: 'Agent' } }, async ($, e, next) => {
    const p = e.props
    if (p.isErrored || p.isInterrupted) return next(e)
    const id = p.output?.agentId ?? calls.get(p.tool_use_id ?? e.requestId)
    const a = id ? ctx.live.get(id) : undefined
    if (!a) return next(e)
    const row = cachedRow(finished, a, { now: Date.now(), tick: ctx.tick })
    const { Box, Text } = $.ui.resolve(e)
    const desc = String(p.input?.description ?? '').trim()
    const kids = [
      Text({ color: row.glyphColor, children: [row.glyph] }),
      Text({ bold: !row.dim, dimColor: row.dim, children: [row.role] }),
      Text({ color: row.modelColor, dimColor: row.dim, children: [row.model] }),
      Box({ flexShrink: 1, children: [Text({ wrap: 'truncate', dimColor: row.dim, children: [Text({ color: row.glyphColor, children: [row.spinner ? row.spinner + ' ' : ''] }), row.activity] })] }),
    ]
    if (row.time) kids.push(Text({ dimColor: true, children: [row.time] }))
    if (row.tok) kids.push(Text({ dimColor: true, children: [row.tok] }))
    if (desc) kids.push(Box({ flexShrink: 1, children: [Text({ wrap: 'truncate', dimColor: true, children: [desc] })] }))
    return Box({ flexDirection: 'row', columnGap: 1, children: kids })
  })
}
