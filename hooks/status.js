// The pinned agt status line under the prompt: one line of what the run is doing, so the
// count survives the band scrolling out of view. Wired in register.js.

import { DONE_GRACE_MS, stage, tokens } from './live.js'

// The line, or undefined to clear it: nothing works and every finished agent is past the grace.
// Only an /agt run pins one: a plain subagent's run is `adhoc`, and the band already shows it.
// `usd` is the measured session cost (session.measure), never an agent's share of it.
export function statusText({ run, subs, panes, done, tok, usd, ctxPct, lastLeftAt, now }) {
  if (run === 'adhoc') return undefined
  if (subs + panes === 0 && (done === 0 || now - (lastLeftAt ?? 0) >= DONE_GRACE_MS)) return undefined
  let text = 'agt ' + run + ' · ◇' + subs + ' ▣' + panes + ' working · ' + done + ' done · ' + tokens(tok) + ' tok'
  if (usd != null) text += ' · $' + usd.toFixed(2) + ' session'
  if (ctxPct != null) text += ' · ctx ' + Math.round(ctxPct) + '%'
  return text
}

// Module state: the hook checker takes `$` only into top-level functions, so none of this nests.
const NOT_SHOWN = Symbol('not shown')
const st = {
  usd: null,
  ctxPct: null,
  shown: NOT_SHOWN, // the last text the host took, so an unchanged line is not re-pinned; unset at load, as a reload may leave the old line pinned
  timer: null,      // clears the line once the grace of the last finished agent runs out
  timerDue: 0,
}

// What a refresh does with the host, as `io`: pin a line, wait, read the clock. The ticker's callbacks
// are handed the same three by register.js, since the hook checker follows `$` itself only into
// top-level functions of the file it is in.
function ioOf($) {
  return { status: (text) => $.ui.status(text), after: (ms, fn) => $.clock.after(ms, fn), now: () => $.clock.now() }
}

// The clock the grace timer waits on; wall time where a host has none to ask.
async function clockNow(io) {
  try {
    return await io.now()
  } catch {
    return Date.now()
  }
}

// Pins `text` unless the host already shows it. A pin the host refuses (no status line in an older
// build, a stale environment) is not remembered, so the next refresh tries again.
export function pin(io, text) {
  if (text === st.shown) return
  try {
    io.status(text)
    st.shown = text
  } catch {
    // cosmetic: the line is tried again on the next refresh
  }
}

// `at` is the time the caller already read (the ticker's); without it the clock is asked.
async function refresh(io, ctx, at) {
  const now = at ?? (await clockNow(io))
  const run = ctx.run
  const subList = [...ctx.live.values()].filter((a) => a.run === run)
  const subs = subList.filter((a) => a.state === 'working').length
  const panes = ctx.panes.filter((p) => p.state === 'working').length
  const { tally } = stage({ agents: ctx.live, panes: ctx.panes, routes: ctx.routes, run })
  const left = [
    ...subList.filter((a) => a.state === 'done').map((a) => a.leftAt ?? a.end),
    ...ctx.routes.filter((r) => r.run === run && r.end != null).map((r) => r.end),
  ].filter((t) => t != null)
  const lastLeftAt = left.length ? Math.max(...left) : null
  const text = statusText({ run, subs, panes, done: tally.done, tok: tally.tok, usd: st.usd, ctxPct: st.ctxPct, lastLeftAt, now })

  pin(io, text)

  // Nothing works but the grace still runs: nothing else redraws, so a timer clears the line.
  const due = text !== undefined && subs + panes === 0 && lastLeftAt != null ? lastLeftAt + DONE_GRACE_MS + 500 : 0
  if (due === st.timerDue) return
  st.timer?.cancel()
  st.timer = null
  st.timerDue = due
  if (due) {
    try {
      st.timer = io.after(due - now, () => {
        st.timer = null
        st.timerDue = 0
        void refresh(io, ctx)
      })
    } catch {
      st.timerDue = 0
    }
  }
}

// The redraw ticker calls this each period while anything works, and once more as it stops; no
// render is involved. Only the lead pins a line: a worker pane runs the same ticker.
async function tickStatus(io, ctx, now) {
  if (ctx.isLead) await refresh(io, ctx, now)
}

export function registerStatus(on, ctx) {
  ctx.onTick.push(tickStatus)

  // The measured session cost and context. register.js holds the unmatched session.measure hook
  // and a second unmatched one is refused, so this one matches on `context`, which is always there.
  on('session.measure', { context: {} }, async ($, e, next) => {
    if (!ctx.isLead) return next(e)
    st.usd = e.cost ? e.cost.usd : null
    st.ctxPct = e.context.percent ?? null
    await refresh(ioOf($), ctx)
    return next(e)
  })
}
