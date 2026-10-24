// agentille turns: what the mod does when a prompt goes in and when a turn ends. register.js wires
// prompt.submit and turn.complete here; the per-turn proofs, the answer memo, the run-end tidy, the worker's
// publish and a subagent's report and ledger all start from these two. The proofs themselves are proofs.js's.

import { S, isLead, Wire } from './state.js'
import { runState, writeRunFile, writeReport, fileRunOf } from './dispatch.js'
import { DECK, addFlag } from './display.js'
import { flagOf, flagKey } from './focus.js'
import { ANSWER_STYLE, RAW_STYLE } from './highlight.js'
import { verdictChip, party, answerLine } from './links.js'
import { addUsage, finish, ledger } from './live.js'
import { BYE_MS } from './mascot.js'
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
  if (S.agtTurn) S.flags = []   // a new run starts with a clean slate
  if (S.agtTurn) await ensureTools($, 'panes')
  if (sessionsAllowed()) await ensureTools($, 'sessions')
  if (S.agtTurn && S.deckAuto) void $.ui.open({ id: DECK, title: 'agentille' })
  if (S.rawTurn) return { ...e, context: [...(e.context ?? []), RAW_STYLE] }
  if (S.shapedTurn) return { ...e, context: [...(e.context ?? []), ANSWER_STYLE] }
  return e
}

// A turn ended: a main-loop answer (raw copy, run-end tidy, the worker's band and report) or a subagent's.
export async function onTurnComplete($, e) {
  const a = e.agentId ? S.live.get(e.agentId) : undefined
  if (!e.agentId) S.leadTurn = false
  if (!e.agentId && e.reason === 'answer' && typeof e.answer === 'string') {
    S.lastAnswer = { text: e.answer, ms: e.durationMs, id: null, shaped: S.shapedTurn, raw: S.rawTurn }
    if (S.highlightOn && (S.agtTurn || S.highlightAll)) $.ui.invalidate('ui.render')
    // A raw answer goes on the clipboard once; a later turn the person did not type is not raw.
    if (S.rawTurn) {
      rawDone()
      const r = await $.ui.copy({ text: e.answer.trim() }).catch(() => null)
      $.ui.toast(r?.isCopied ? 'Copied to the clipboard: paste it as is.' : 'agentille: could not copy the answer (' + (r?.reason ?? 'error') + ')')
    }
    // A run's ✓/✗ card ends it: its own ⚑ lines carry what is left, so the band's flags come down,
    // what the run leaves behind is tidied (finished orphans, merged worktrees), and the typed proof
    // lapses: the next worker pane needs the next typed /agt. A run nobody typed /agt for tidies nothing.
    const card = isLead() && /^[✓✗]/.test(e.answer.trimStart())
    if (card && S.agtTurn && S.agtTyped) {
      S.flags = []
      endRun()
      void cleanWorkspace($, { auto: true }).catch(() => {})
    } else if (card && runHeld()) endRun() // a card after the person typed in between still ends the run's guard

  }
  if (!e.agentId && S.worker && S.mascot.working) {
    const now = await $.clock.now()
    S.mascot.working = false
    S.mascot.ms = now - S.mascot.start
    if (e.reason === 'answer') S.mascot.byeUntil = now + BYE_MS
    ensureTicker($)
    $.ui.invalidate('ui.render')
  }
  if (!e.agentId && S.wireName && Wire.pub.state === 'working') {
    pubDone()
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
    if (a.routed && a.run !== 'adhoc') noteWire({ from: party(a.role, a.piece), to: 'lead', kind: 'done', summary: answerLine(a.role, e.answer), at: Date.now(), via: 'sub' })
    if (a.role === 'plan-reviewer' && verdictOf(e.answer) === 'REVISE') runState(fileRunOf(a)).revise += 1
    if (a.input + a.output === 0) addUsage(a, e.usage)
    finish(a, Date.now(), e.durationMs)
    await writeReport($, a, e.answer)
    await writeRunFile($, fileRunOf(a), 'ledger.json', JSON.stringify(ledger(S.live, fileRunOf(a), S.paneRoutes), null, 2) + '\n')
    ensureTicker($)
    void refreshAgents($)
    $.ui.invalidate('ui.render')
  }
}
