// The pinned agt status line under the prompt: one line of what the run is doing, so the
// count survives the band scrolling out of view. Wired in register.js.

import { DONE_GRACE_MS, stage, tokens } from './live.js'

// The line, or undefined to clear it: nothing works and every finished agent is past the grace.
// `usd` is the measured session cost (session.measure), never an agent's share of it.
export function statusText({ run, subs, panes, done, tok, usd, ctxPct, lastLeftAt, now }) {
  if (subs + panes === 0 && (done === 0 || now - (lastLeftAt ?? 0) >= DONE_GRACE_MS)) return undefined
  let text = 'agt ' + run + ' · ◇' + subs + ' ▣' + panes + ' working · ' + done + ' done · ' + tokens(tok) + ' tok'
  if (usd != null) text += ' · $' + usd.toFixed(2) + ' session'
  if (ctxPct != null) text += ' · ctx ' + Math.round(ctxPct) + '%'
  return text
}

// Module state: the hook checker takes `$` only into top-level functions, so none of this nests.
const st = {
  usd: null,
  ctxPct: null,
  shown: undefined, // the last text handed to $.ui.status, so an unchanged line is not re-pinned
  timer: null,      // clears the line once the grace of the last finished agent runs out
  timerDue: 0,
}

// The clock the grace timer waits on; wall time where a host has none to ask.
async function clockNow($) {
  try {
    return await $.clock.now()
  } catch {
    return Date.now()
  }
}

async function refresh($, ctx) {
  const now = await clockNow($)
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

  if (text !== st.shown) {
    st.shown = text
    $.ui.status(text)
  }

  // Nothing works but the grace still runs: nothing else redraws, so a timer clears the line.
  const due = text !== undefined && subs + panes === 0 && lastLeftAt != null ? lastLeftAt + DONE_GRACE_MS + 500 : 0
  if (due === st.timerDue) return
  st.timer?.cancel()
  st.timer = null
  st.timerDue = due
  if (due) {
    try {
      st.timer = $.clock.after(due - now, () => {
        st.timer = null
        st.timerDue = 0
        void refresh($, ctx)
      })
    } catch {
      st.timerDue = 0
    }
  }
}

export function registerStatus(on, ctx) {
  // The measured session cost and context. register.js holds the unmatched session.measure hook
  // and a second unmatched one is refused, so this one matches on `context`, which is always there.
  on('session.measure', { context: {} }, async ($, e, next) => {
    st.usd = e.cost ? e.cost.usd : null
    st.ctxPct = e.context.percent ?? null
    await refresh($, ctx)
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    await refresh($, ctx)
    return next(e)
  })
}
