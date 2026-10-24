// agentille turns: what the mod does when a prompt goes in and when a turn ends. register.js wires
// prompt.submit and turn.complete here; the per-turn proofs, the answer memo, the run-end tidy, the worker's
// publish and a subagent's report and ledger all start from these two. The proofs themselves are proofs.js's.

import { isLead, Wire, Display, Runs, Proofs, Session, setLeadTurn } from './state.js'
import { writeRunFile, writeReport, fileRunOf, agentDone, countRevise } from './dispatch.js'
import { DECK, addFlag, clearFlags, setLastAnswer, mascotRest } from './display.js'
import { flagOf, flagKey } from './focus.js'
import { ANSWER_STYLE, RAW_STYLE } from './highlight.js'
import { verdictChip, party, answerLine } from './links.js'
import { ledger } from './live.js'
import { cleanWorkspace } from './reaper.js'
import { typedPrompt, agtTurnStart, endRun, rawDone, sessionsAllowed, moment, runHeld } from './proofs.js'
import { loadRunProfile } from './guard.js'
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
  // Snapshot the run's integration ceiling from the profile now, so a later rewrite cannot raise it mid-run.
  if (agt) await loadRunProfile($)
  if (Proofs.agtTurn) clearFlags()   // a new run starts with a clean slate
  if (Proofs.agtTurn) await ensureTools($, 'panes')
  if (sessionsAllowed()) await ensureTools($, 'sessions')
  if (Proofs.agtTurn && Display.deckAuto) void $.ui.open({ id: DECK, title: 'agentille' })
  if (Proofs.rawTurn) return { ...e, context: [...(e.context ?? []), RAW_STYLE] }
  if (Proofs.shapedTurn) return { ...e, context: [...(e.context ?? []), ANSWER_STYLE] }
  return e
}

// The recon line a solo run prints first (SKILL.md → "Levels": `recon: low · solo · <reason>`). Anchored on a line
// start, so a quoted one inside a sentence does not count; the ` · advisor` and version suffixes do not matter.
export const SOLO_RECON = /^[ \t]*recon:[ \t]*low[ \t]*·[ \t]*solo[ \t]*·/m

// Whether the main turn that just ended printed a solo recon line: its final answer, or any assistant message since
// the newest prompt (a user row with no tool results), since the line comes before the tool calls. An unreadable
// transcript reads as no, so the hold stays.
export async function soloTurn($, answer) {
  if (SOLO_RECON.test(String(answer ?? ''))) return true
  const rows = await Promise.resolve().then(() => $.session.messages()).catch(() => null)
  if (!Array.isArray(rows)) return false
  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i]
    if (r?.role === 'user' && !(r.toolResults?.length)) return false
    if (r?.role === 'assistant' && SOLO_RECON.test(String(r.text ?? ''))) return true
  }
  return false
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
    // A solo run prints no card: its recon line marks it, and the end of the turn that printed it ends the run.
    else if (!card && isLead() && runHeld() && await soloTurn($, e.answer)) endRun()
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
    if (a.routed) addFlag($, flagKey(a.role, a.slice), flagOf(a.role, e.answer))
    if (a.routed && a.run !== 'adhoc') noteWire({ from: party(a.role, a.slice), to: 'lead', kind: 'done', summary: answerLine(a.role, e.answer), at: Date.now(), via: 'sub' })
    if (a.role === 'plan-reviewer' && verdictOf(e.answer) === 'REVISE') countRevise(fileRunOf(a))
    agentDone(e.agentId, { verdict: verdictChip(a.role, e.answer), usage: e.usage, now: Date.now(), durationMs: e.durationMs })
    await writeReport($, a, e.answer)
    await writeRunFile($, fileRunOf(a), 'ledger.json', JSON.stringify(ledger(Runs.live, fileRunOf(a), Runs.paneRoutes), null, 2) + '\n')
    ensureTicker($)
    void refreshAgents($)
    $.ui.invalidate('ui.render')
  }
}
