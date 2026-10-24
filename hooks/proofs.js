// agentille proofs: what the person typed is the only proof the mod's gates trust. The fields live on S (state.js)
// so ctx and the readers keep their getters, but every write goes through a named transition here:
//
//   typedPrompt(text, origin)  every prompt.submit: the per-turn proofs end, a typed /agt starts a run's proof,
//                              a worker's first prompt decides its fable proof, a typed ask for sessions or for
//                              raw or shaped text holds for its own turn
//   startRun(id)               the typed /agt's own turn named its run (a pane; a routed dispatch through
//                              dispatchedRun): later turns may open panes for that run only
//   endRun()                   the run's ✓/✗ card: the /agt proof and its --fable lapse
//   dropProof()                the first turn after the run is over (routing.js runInFlight): the same lapse
//   rawDone()                  the raw answer went on the clipboard: a later turn is not raw
//
// and the gates read them through spawnAllowed, sessionsAllowed and fableProof.

import { S, isLead } from './state.js'
import { SAFE_RUN } from './panes.js'
import * as P from './panerec.js'
import { isRawPrompt } from './highlight.js'
import { isAgtPrompt } from './live.js'
import { parseHeader, typedFable, asksSessions, runInFlight } from './routing.js'

// A composer or bridge prompt is the person's; a task notification, plugin or peer turn is not, and neither is one
// whose origin the host did not name.
export const isTyped = (origin) => origin?.kind === 'composer' || origin?.kind === 'bridge'

// prompt.submit → { typed, agt }. Per-turn proofs end with their turn, whatever starts the next one: a notification
// after a typed "open a session" opens none. The /agt proof lasts while its run is in flight; in a lead, the first
// turn after that run is over drops it and its --fable, so a later header proves nothing.
// `at` is moment($): the clock and the panes' rest ages, for the in-flight test.
export function typedPrompt(text, origin, at = NO_MOMENT) {
  const typed = isTyped(origin)
  const agt = typed && isAgtPrompt(text)
  S.sessionsAsked = false
  S.rawTurn = false
  S.shapedTurn = false
  S.agtBirth = false
  if (typed && !agt) S.agtTypedSince += 1
  if (isLead() && S.agtTyped && !agt && !inFlight(S, at)) dropProof()
  if (!typed) return { typed, agt }
  S.lastTyped = String(text ?? '')
  // A typed /agt unlocks spawn_pane for its run, and --fable on it is what makes fable=forced hold.
  if (agt) {
    S.agtTyped = true
    S.agtTypedSince = 0
    S.fableTyped = typedFable(text)
    S.agtPrompt = S.lastTyped
    S.agtTypedAt = at.clock
    S.agtBirth = true
    S.agtRun = null
  }
  // A worker's proof is its first prompt: the lead already rewrote fable=forced there when nobody typed --fable.
  if (S.worker && !S.workerProved) {
    S.workerProved = true
    S.fableTyped = parseHeader(text)?.fable === 'forced' || typedFable(text)
  }
  // Only a typed ask opens sessions, on that turn.
  S.sessionsAsked = !agt && isLead() && asksSessions(text)
  // Under display.highlight: all, a typed question in the lead session asks for the panel's shape. Never in a worker
  // pane (the lead parses its report) and never for a slash command or an /agt run. Asked for text to paste as is: no
  // panel and no answer style. Under display.highlight: off nothing is added, so the raw style needs on or all.
  const asked = !agt && isLead() && !String(text ?? '').trimStart().startsWith('/')
  S.rawTurn = asked && S.highlightOn && isRawPrompt(text)
  S.shapedTurn = !S.rawTurn && asked && S.highlightOn && S.highlightAll
  return { typed, agt }
}

// The typed /agt's turn named a run id. Only the first counts, and only from a lead whose proof holds; a later turn
// that finds none yet (the run planned, asked a question, and builds after the answer) adopts its first pane's.
export function startRun(id) {
  if (!isLead() || !S.agtTyped || S.agtRun || !SAFE_RUN.test(String(id ?? '')) || id === 'adhoc') return
  S.agtRun = id
}

// A routed dispatch on the typed /agt's own turn names the run from its header.
export function dispatchedRun(id) {
  if (S.agtBirth) startRun(id)
}

// The run's ✓/✗ card: the next worker pane needs the next typed /agt.
export function endRun() {
  S.agtTyped = false
  S.fableTyped = false
  S.agtRun = null
}

// The run is over without a card (a question, an error, an interrupt): the proof lapses the same way.
export function dropProof() {
  S.agtTyped = false
  S.fableTyped = false
  S.agtRun = null
}

export function rawDone() {
  S.rawTurn = false
}

// Now on the reaper's clock ($.clock, as its `since` is), and how long each pane has sat in its current state there:
// for runInFlight's AGT_INFLIGHT_MAX_MS and PANE_REST_MS. A rest age is null for a pane the reaper has not timed yet.
const NO_MOMENT = { clock: null, rest: () => null }
export async function moment($) {
  const clock = await Promise.resolve().then(() => $.clock.now()).catch(() => null)
  if (typeof clock !== 'number') return NO_MOMENT
  const rest = (p) => {
    const s = P.seen.get(p.id)
    return s && s.state === p.state && typeof s.since === 'number' ? clock - s.since : null
  }
  return { clock, rest }
}
const inFlight = (st, at) => runInFlight(st, Date.now(), at.rest, at.clock)

// spawn_pane's typed gate: null when it may open a pane, else the one sentence it is denied with. With no `runId`,
// only the typed /agt and its run in flight are checked. The typed /agt's own turn may open any run id (that is
// where the id is born) and is never past the in-flight cap; a later turn opens panes only for the run's own id.
export function spawnAllowed(runId = null, st = S, at = NO_MOMENT) {
  if (!st.agtTyped) return 'spawn_pane opens worker panes only in a session where /agt was typed.'
  if (!st.agtBirth && !inFlight(st, at)) return 'spawn_pane opens worker panes only while the typed /agt run is in flight; the next run needs the next typed /agt.'
  if (runId !== null && !st.agtBirth && st.agtRun && runId !== st.agtRun) return 'spawn_pane opens panes only for run ' + st.agtRun + ', the run the typed /agt started; run ' + runId + ' needs its own typed /agt.'
  return null
}

// open_sessions runs only on a turn where the person typed an ask for sessions.
export const sessionsAllowed = () => S.sessionsAsked

// Whether a header's fable=forced holds: the typed --fable (a lead) or the first prompt's header (a worker).
export const fableProof = () => S.fableTyped
