// agentille turns: what the mod does when a prompt goes in and when a turn ends. register.js wires
// prompt.submit and turn.complete here; the per-turn proofs, the answer memo, the run-end tidy, the worker's
// publish and a subagent's report and ledger all start from these two.

import { S } from './state.js'
import { runState, writeRunFile, writeReport, fileRunOf } from './dispatch.js'
import { DECK, addFlag } from './display.js'
import { flagOf, flagKey } from './focus.js'
import { ANSWER_STYLE, isRawPrompt, RAW_STYLE } from './highlight.js'
import { verdictChip, party, answerLine } from './links.js'
import { addUsage, finish, ledger, isAgtPrompt } from './live.js'
import { BYE_MS } from './mascot.js'
import { cleanWorkspace } from './reaper.js'
import { parseHeader, typedFable, asksSessions, verdictOf, runInFlight } from './routing.js'
import { ensureTools } from './spawn.js'
import { refreshAgents, ensureTicker } from './ticker.js'
import { logWire } from './wire.js'
import { publish, saveAnswer, reportDone } from './worker.js'
const { live, paneRoutes, mascot, wireLog, pub } = S

// A typed /agt starts a clean run; a task notification, plugin or peer turn is not the person's prompt,
// and neither is one whose origin the host did not name. Returns the event to pass on: the answer style
// is added to its context when this turn asks for one.
export async function onPromptSubmit($, e) {
  const k = e.origin?.kind
  const typed = k === 'composer' || k === 'bridge'
  const agt = typed && isAgtPrompt(e.text)
  // Per-turn proofs end with their turn, whatever starts the next one: a notification after a typed "open a
  // session" opens none. The /agt proof lasts while its run is in flight (routing.js runInFlight); in a lead,
  // the first turn after that run is over drops it and its --fable, so a later header proves nothing.
  S.sessionsAsked = false
  S.rawTurn = false
  S.shapedTurn = false
  if (typed && !agt) S.agtTypedSince += 1
  if (!S.selfName && !S.worker && S.agtTyped && !agt && !runInFlight(S)) { S.agtTyped = false; S.fableTyped = false }
  if (!typed) return e
  S.lastTyped = String(e.text ?? '')
  S.agtTurn = agt
  if (S.agtTurn) S.flags = []   // a new run starts with a clean slate
  // What the person typed is the only proof the dispatch headers get: a typed /agt unlocks spawn_pane for its
  // run, --fable on it is what makes fable=forced hold, and only a typed ask opens sessions, on that turn.
  if (S.agtTurn) { S.agtTyped = true; S.agtTypedSince = 0; S.fableTyped = typedFable(e.text); S.agtPrompt = S.lastTyped }
  if (S.agtTurn) await ensureTools($, 'panes')
  // A worker's proof is its first prompt: the lead already rewrote fable=forced there when nobody typed --fable.
  if (S.worker && !S.workerProved) { S.workerProved = true; S.fableTyped = parseHeader(e.text)?.fable === 'forced' || typedFable(e.text) }
  S.sessionsAsked = !S.agtTurn && !S.selfName && !S.worker && asksSessions(e.text)
  if (S.sessionsAsked) await ensureTools($, 'sessions')
  if (S.agtTurn && S.deckAuto) void $.ui.open({ id: DECK, title: 'agentille' })
  // Under display.highlight: all, a typed question in the lead session asks for the panel's shape.
  // Never in a worker pane (the lead parses its report) and never for a slash command or an /agt run.
  const asked = !S.agtTurn && !S.selfName && !S.worker && !String(e.text ?? '').trimStart().startsWith('/')
  // Asked for text to paste as is: no panel and no answer style. Under display.highlight: off nothing is
  // added to any prompt and nothing is copied, so the raw style needs highlight on or all.
  S.rawTurn = asked && S.highlightOn && isRawPrompt(e.text)
  S.shapedTurn = !S.rawTurn && asked && S.highlightOn && S.highlightAll
  if (S.rawTurn) return { ...e, context: [...(e.context ?? []), RAW_STYLE] }
  if (S.shapedTurn) return { ...e, context: [...(e.context ?? []), ANSWER_STYLE] }
  return e
}

// A turn ended: a main-loop answer (raw copy, run-end tidy, the worker's band and report) or a subagent's.
export async function onTurnComplete($, e) {
  const a = e.agentId ? live.get(e.agentId) : undefined
  if (!e.agentId) S.leadTurn = false
  if (!e.agentId && e.reason === 'answer' && typeof e.answer === 'string') {
    S.lastAnswer = { text: e.answer, ms: e.durationMs, id: null, shaped: S.shapedTurn, raw: S.rawTurn }
    if (S.highlightOn && (S.agtTurn || S.highlightAll)) $.ui.invalidate('ui.render')
    // A raw answer goes on the clipboard once; a later turn the person did not type is not raw.
    if (S.rawTurn) {
      S.rawTurn = false
      const r = await $.ui.copy({ text: e.answer.trim() }).catch(() => null)
      $.ui.toast(r?.isCopied ? 'Copied to the clipboard: paste it as is.' : 'agentille: could not copy the answer (' + (r?.reason ?? 'error') + ')')
    }
    // A run's ✓/✗ card ends it: its own ⚑ lines carry what is left, so the band's flags come down,
    // what the run leaves behind is tidied (finished orphans, merged worktrees), and the typed proof
    // lapses: the next worker pane needs the next typed /agt. A run nobody typed /agt for tidies nothing.
    if (S.agtTurn && S.agtTyped && !S.selfName && !S.worker && /^[✓✗]/.test(e.answer.trimStart())) {
      S.flags = []
      S.agtTyped = false
      S.fableTyped = false
      void cleanWorkspace($, { auto: true }).catch(() => {})
    }
  }
  if (!e.agentId && S.worker && mascot.working) {
    const now = await $.clock.now()
    mascot.working = false
    mascot.ms = now - mascot.start
    if (e.reason === 'answer') mascot.byeUntil = now + BYE_MS
    ensureTicker($)
    $.ui.invalidate('ui.render')
  }
  if (!e.agentId && S.wireName && pub.state === 'working') {
    Object.assign(pub, { state: 'done', tool: null, ms: Date.now() - (pub.start ?? Date.now()) })
    await publish($, true)
    if (e.reason === 'answer') await reportDone($, e.answer)
  } else if (!e.agentId && !S.wireName && S.selfName && e.reason === 'answer') {
    // A lead that gave this pane no wire identity (an older agentille, a hand-made pane) never hears from
    // it; the saved answer is all it can leave, and what the lead reads before closing the pane.
    await saveAnswer($, S.selfName, e.answer)
  }
  if (a) {
    a.tool = null
    if (a.routed) addFlag($, flagKey(a.role, a.piece), flagOf(a.role, e.answer))
    a.verdict = verdictChip(a.role, e.answer)
    if (a.routed && a.run !== 'adhoc') logWire(wireLog, { from: party(a.role, a.piece), to: 'lead', kind: 'done', summary: answerLine(a.role, e.answer), at: Date.now(), via: 'sub' })
    if (a.role === 'plan-reviewer' && verdictOf(e.answer) === 'REVISE') runState(fileRunOf(a)).revise += 1
    if (a.input + a.output === 0) addUsage(a, e.usage)
    finish(a, Date.now(), e.durationMs)
    await writeReport($, a, e.answer)
    await writeRunFile($, fileRunOf(a), 'ledger.json', JSON.stringify(ledger(live, fileRunOf(a), paneRoutes), null, 2) + '\n')
    ensureTicker($)
    void refreshAgents($)
    $.ui.invalidate('ui.render')
  }
}
