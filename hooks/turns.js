// agentille turns: what the mod does when a prompt goes in and when a turn ends. register.js wires
// prompt.submit and turn.complete here; the per-turn proofs, the answer memo, the run-end tidy, the worker's
// publish and a subagent's report and ledger all start from these two. The proofs themselves are proofs.js's.

import { isLead, Wire, Display, Runs, Proofs, Session, setLeadTurn } from './state.js'
import { runState, writeRunFile, writeReport, fileRunOf } from './dispatch.js'
import { DECK, addFlag, clearFlags, setLastAnswer, mascotRest } from './display.js'
import { flagOf, flagKey } from './focus.js'
import { ANSWER_STYLE, RAW_STYLE } from './highlight.js'
import { verdictChip, party, answerLine } from './links.js'
import { addUsage, finish, ledger } from './live.js'
import { cleanWorkspace } from './reaper.js'
import { typedPrompt, agtTurnStart, endRun, rawDone, sessionsAllowed, moment, runHeld } from './proofs.js'
import { verdictOf } from './routing.js'
import { ensureTools } from './spawn.js'
import { refreshAgents, ensureTicker } from './ticker.js'
import { publish, saveAnswer, reportDone, noteWire, pubDone } from './worker.js'

// A typed /agt starts a clean run; the turn's proofs are set or dropped in proofs.js. Returns the event to pass on:
// the answer style is added to its context when this turn asks for one.
export async function onPromptSubmit($, e) {
  const { typed, agt } = typedPrompt(e.text, e.origin, await moment($))
  if (!typed) return e
  agtTurnStart(agt)
  if (Proofs.agtTurn) clearFlags()   // a new run starts with a clean slate
  if (Proofs.agtTurn) await ensureTools($, 'panes')
  if (sessionsAllowed()) await ensureTools($, 'sessions')
  if (Proofs.agtTurn && Display.deckAuto) void $.ui.open({ id: DECK, title: 'agentille' })
  if (Proofs.rawTurn) return { ...e, context: [...(e.context ?? []), RAW_STYLE] }
  if (Proofs.shapedTurn) return { ...e, context: [...(e.context ?? []), ANSWER_STYLE] }
  return e
}

// A turn ended: a main-loop answer (raw copy, run-end tidy, the worker's band and report) or a subagent's.
export async function onTurnComplete($, e) {
  const a = e.agentId ? Runs.live.get(e.agentId) : undefined
  if (!e.agentId) setLeadTurn(false)
  if (!e.agentId && e.reason === 'answer' && typeof e.answer === 'string') {
    setLastAnswer({ text: e.answer, ms: e.durationMs, id: null, shaped: Proofs.shapedTurn, raw: Proofs.rawTurn })
    if (Display.highlightOn && (Proofs.agtTurn || Display.highlightAll)) $.ui.invalidate('ui.render')
    // A raw answer goes on the clipboard once; a later turn the person did not type is not raw.
    if (Proofs.rawTurn) {
      rawDone()
      const r = await $.ui.copy({ text: e.answer.trim() }).catch(() => null)
      $.ui.toast(r?.isCopied ? 'Copied to the clipboard: paste it as is.' : 'agentille: could not copy the answer (' + (r?.reason ?? 'error') + ')')
    }
    // A run's ✓/✗ card ends it: its own ⚑ lines carry what is left, so the band's flags come down,
    // what the run leaves behind is tidied (finished orphans, merged worktrees), and the typed proof
    // lapses: the next worker pane needs the next typed /agt. A run nobody typed /agt for tidies nothing.
    const card = isLead() && /^[✓✗]/.test(e.answer.trimStart())
    if (card && Proofs.agtTurn && Proofs.agtTyped) {
      clearFlags()
      endRun()
      void cleanWorkspace($, { auto: true }).catch(() => {})
    } else if (card && runHeld()) endRun() // a card after the person typed in between still ends the run's guard

  }
  if (!e.agentId && Session.worker && Display.mascot.working) {
    const now = await $.clock.now()
    mascotRest(now, e.reason === 'answer')
    ensureTicker($)
    $.ui.invalidate('ui.render')
  }
  if (!e.agentId && Session.wireName && Wire.pub.state === 'working') {
    pubDone()
    await publish($, true)
    if (e.reason === 'answer') await reportDone($, e.answer)
  } else if (!e.agentId && !Session.wireName && Session.selfName && e.reason === 'answer') {
    // A lead that gave this pane no wire identity (an older agentille, a hand-made pane) never hears from
    // it; the saved answer is all it can leave, and what the lead reads before closing the pane.
    await saveAnswer($, Session.selfName, e.answer)
  }
  if (a) {
    a.tool = null
    if (a.routed) addFlag($, flagKey(a.role, a.piece), flagOf(a.role, e.answer))
    a.verdict = verdictChip(a.role, e.answer)
    if (a.routed && a.run !== 'adhoc') noteWire({ from: party(a.role, a.piece), to: 'lead', kind: 'done', summary: answerLine(a.role, e.answer), at: Date.now(), via: 'sub' })
    if (a.role === 'plan-reviewer' && verdictOf(e.answer) === 'REVISE') runState(fileRunOf(a)).revise += 1
    if (a.input + a.output === 0) addUsage(a, e.usage)
    finish(a, Date.now(), e.durationMs)
    await writeReport($, a, e.answer)
    await writeRunFile($, fileRunOf(a), 'ledger.json', JSON.stringify(ledger(Runs.live, fileRunOf(a), Runs.paneRoutes), null, 2) + '\n')
    ensureTicker($)
    void refreshAgents($)
    $.ui.invalidate('ui.render')
  }
}
