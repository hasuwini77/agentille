// agentille timers: the agent list refresh, the 5 s pane poll that runs while panes may exist, and the 300 ms
// redraw ticker that runs while something works or animates.

import { ctx, ctxSource, Session } from './session.js'
import { Display } from './display.js'
import { Spawn } from './spawn.js'
import { Sessions } from './sessions.js'
import { makeStore } from './store.js'
import { waving } from './live.js'
import { moodAt } from './mascot.js'
import { Panes, pollNow } from './reaper.js'
import { Runs, adoptAgents, applyAgentList, quietAgents } from './dispatch.js'
import { readWire } from './worker.js'

// The redraw count is read by the drawing (Timers.tick, ctx.tick); the timers and the agent-list throttle are this
// module's alone.
const { s: my, view } = makeStore('ticker.js', { tick: 0 })
export const Timers = view
ctxSource({ timers: view })
let pollTimer = null  // pane polling: runs only while panes may exist
let quietPolls = 0
let tickTimer = null  // redraw ticker: runs only while something works
let listAt = 0
let listBusy = false

export const LIST_MS = 1000         // $.agent.list() is read at most this often

export const LIST_RETRY_MS = 30_000 // ... and after a failed read, at most this often

// The engine's agent list is the truth for who exists and who spawned whom. Read it at session
// start (a reload loses the live map) and while agents work; render hooks only see the copy.
// A failed read leaves everything as it was.
export async function refreshAgents($, at) {
  const now = at ?? await $.clock.now()
  if (listBusy || now - listAt < LIST_MS) return
  listBusy = true
  listAt = now
  try {
    if (quietAgents(Date.now())) $.ui.invalidate('ui.render')
    let list
    try {
      list = await $.agent.list()
    } catch {
      listAt = now + LIST_RETRY_MS - LIST_MS // no agent list here (an older build, a host without agents): the band runs on events alone, and the list is retried rarely
    }
    if (!Array.isArray(list)) return
    const added = adoptAgents(list, now).length > 0
    const changed = applyAgentList(list, now)
    if (working()) ensureTicker($)
    if (added || changed) $.ui.invalidate('ui.render')
  } finally {
    listBusy = false
  }
}

export const working = () => [...Runs.live.values()].some((a) => a.state === 'working') || Panes.panes.some((p) => p.state === 'working')

// Pane polling starts when panes can exist (an /agt run, a spawn, panes found at start) and
// stops after a minute with no agt- pane and nothing working.
export function ensurePolling($) {
  if (pollTimer || !Spawn.transport || Spawn.transport === 'none') return
  quietPolls = 0
  pollTimer = $.clock.every(5000, () => {
    pollNow($, Spawn.transport).then(() => {
      if (Panes.panes.length || Sessions.sessions.length || working()) { quietPolls = 0; ensureTicker($); return }
      if (++quietPolls >= 12) { pollTimer?.cancel(); pollTimer = null }
    })
  })
}

// Redraw while something works, a worker's mascot is animating or a finished subagent is
// still waving (elapsed times tick, legs step); the ticker cancels itself once all are idle.
export const animating = (now) => (!!Session.worker && moodAt({ ...Display.mascot, now }) !== 'idle') || [...Runs.live.values()].some((a) => waving(a, now))

// The modules that follow the run on the ticker (the pinned status line) add a callback to ctx.onTick.
// They get the three host calls they use as `io` (status.js ioOf has the same shape), with the `now` the
// ticker already read.
export async function tickModules($, now) {
  const io = { status: (text) => $.ui.status(text), after: (ms, fn) => $.clock.after(ms, fn), now: () => $.clock.now() }
  for (const f of ctx.onTick) {
    try {
      await f(io, ctx, now)
    } catch {
      // one module's tick must not stop the others or the redraw
    }
  }
}

export function ensureTicker($) {
  if (tickTimer) return
  tickTimer = $.clock.every(300, async () => {
    const now = await $.clock.now()
    if (!working() && !animating(now)) {
      tickTimer?.cancel()
      tickTimer = null
    } else my.tick += 1
    await tickModules($, now) // also on the tick that stops the ticker, so the last change is seen
    if (Panes.panes.length && my.tick % 3 === 0) await readWire($)
    if (my.tick % 4 === 0) void refreshAgents($, now)
    $.ui.invalidate('ui.render')
  })
}
