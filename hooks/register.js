// agentille mod entry: wires the hooks. The state is in state.js; routing, panes, sessions, the reaper, the
// timers, the worker's wire, display settings, drawing and run files each have a module beside this one.

import { S, ctx } from './state.js'
import { registerAutocomplete } from './autocomplete.js'
import { toolLabel, runPhases } from './board.js'
import { cleanText } from './clean.js'
import { runState, routingView, ledgerView, writeRunFile, writeReport, fileRunOf, completeReport, dispatchAgent } from './dispatch.js'
import { DECK, applyDisplay, addFlag, answerPanel, deckCommand, focusCommand, highlightCommand } from './display.js'
import { canDraw, drawingBlock, reportRun } from './drawing.js'
import { flagOf, flagKey } from './focus.js'
import { highlightFor, litFor, ANSWER_STYLE, isRawPrompt, RAW_STYLE } from './highlight.js'
import { parseInfoArgs, routeText, routingSummary, ledgerSummary, squadsSummary, overviewText } from './info.js'
import { verdictChip, party, answerLine } from './links.js'
import { addUsage, finish, ledger, isAgtPrompt } from './live.js'
import { HELLO_MS, BYE_MS, parseWorker } from './mascot.js'
import { PROBE, SPAWN_ROLE, transportBlock, paneName, newRunId, paneKey, parseSpawnArgs, herdrPromptArgv } from './panes.js'
import { installedSkew, loadProfile, loadSquads, squadsView, tipOnce } from './profile.js'
import { bashCall } from './guard.js'
import { pollNow, cleanWorkspace } from './reaper.js'
import { cardBox, answerBox, switchboard, deck } from './render.js'
import { parseHeader, typedFable, asksSessions, verdictOf, runInFlight } from './routing.js'
import { registerRows } from './rows.js'
import { hostMessage, hostTooOld, hostVersionOf, skewMessage } from './skew.js'
import { detectTransport, transportOf, openPane, ensureTools, loadOwned, savePanes } from './spawn.js'
import { spawnPane, openSessions, closePane } from './tools.js'
import { registerStatus } from './status.js'
import { refreshAgents, working, ensurePolling, ensureTicker } from './ticker.js'
import { statusKey, freshStatus, validLead, parseWire, shortName, logWire, parseTellArgs } from './wire.js'
import { publish, saveAnswer, reportDone } from './worker.js'
const { runs, live, decisions, paneRoutes, openedNames, paneSeen, harvested, wireDone, woken, strandedToasted, firstSeen, ownedTabs, mascot, litMemo, hlMemo, rawIds, wireLog, pub } = S

export function register(on) {
  on('session.start', async ($, e, next) => {
    await loadProfile($)
    await loadSquads($)
    try {
      S.runningVersion = JSON.parse(await $.fs.read($.plugin.root + '/.claude-plugin/plugin.json')).version ?? null
    } catch {
      S.runningVersion = null
    }
    const skew = await installedSkew($)
    if (skew) {
      S.skewToasted = true
      $.ui.toast('agt ⚑ ' + skewMessage(skew, S.runningVersion))
    }
    // The host's own version: too old for the mod's pane tools → one toast, and ensureTools registers none.
    S.hostVersion = hostVersionOf(await Promise.resolve().then(() => $.session.version()).catch(() => null))
    if (S.hostVersion && hostTooOld(S.hostVersion)) {
      S.hostOld = true
      $.ui.toast('agt ⚑ ' + hostMessage(S.hostVersion))
    }
    S.transport = await detectTransport($)
    S.worker = parseWorker(await $.env.get('AGENTILLE_WORKER'))
    S.sessionId = validLead(await $.session.id().catch(() => null))
    S.wireName = /^agt-[A-Za-z0-9_-]+$/.test((await $.env.get('AGENTILLE_NAME')) ?? '') ? await $.env.get('AGENTILLE_NAME') : null
    S.leadSession = S.wireName ? validLead(await $.env.get('AGENTILLE_LEAD')) : null
    if (S.worker) { pub.model = S.worker.model; pub.effort = S.worker.effort || null }
    await $.command.register({ name: 'agt-deck', description: 'Open the agentille deck: the cast, routing timeline, wire log and tokens. auto = open on every /agt (saved as display.deck) · off', argumentHint: '[auto|off]', immediate: true })
    await $.command.register({ name: 'agt-tell', description: 'Send a message to a worker pane over the wire', argumentHint: '<worker> <message>', immediate: true })
    await $.command.register({ name: 'agt-spawn', description: 'Open a routed claude pane beside this one (Herdr or tmux); it closes itself once its answer is saved', argumentHint: '"task" [--model sonnet|opus|haiku|fable]' })
    S.storedRaw = {
      deckAuto: await $.store.get('deck:auto'),
      focusMode: await $.store.get('focus:mode'),
      highlightOn: await $.store.get('highlight:on'),
      highlightAll: await $.store.get('highlight:all'),
    }
    applyDisplay()
    await $.command.register({ name: 'agt-info', description: 'Settings in effect, routing, ledger, squads, or a route dry-run: routing | ledger | squads | route <role>', argumentHint: '[routing|ledger|squads|route <role> [size=…] [risk=…] [depth=…]]', immediate: true })
    await $.command.register({ name: 'agt-highlight', description: 'Highlight replies: on (/agt replies lit; a paste-ready ask gets a plain-text note) · all (every typed question gets the answer shape) · off (nothing added to any prompt). Saved as display.highlight in profile.json; goes away in v4', argumentHint: '[on|all|off]', immediate: true })
    await $.command.register({ name: 'agt-clean', description: 'Tidy up now: close finished agt panes, remove merged agt/* worktrees and branches, drop run folders untouched for 14 days. Anything still working or unmerged stays', immediate: true })
    await $.command.register({ name: 'agt-focus', description: 'Agent flags above the prompt (a REVISE, a FAIL, a blocked pane): on · off. Saved as display.focus in profile.json; goes away in v4', argumentHint: '[on|off]', immediate: true })
    if (S.transport !== 'none') {
      // One look now: a lead restarted mid-run takes back the panes it opened (lead-<pane>.panes) and no other
      // session's. It reaps only those whose answer was written after this look; an older one is flagged
      // "not harvested" and left to the person. A session that opened none polls nothing.
      await loadOwned($)
      await pollNow($, S.transport)
      if (S.panes.length) ensurePolling($)
      // A lead that died skipped its SessionEnd sweep: close its finished workers now.
      if (S.panes.length && !S.selfName && !S.worker) void cleanWorkspace($, { auto: true, panesOnly: true }).catch(() => {})
    }
    if (working()) ensureTicker($)
    if (S.wireName) await publish($, true)
    await refreshAgents($)
    return next(e)
  })

  // The display toggles answer from display.js: deck (open it, auto, off), focus and highlight.
  on('command.run', { command: 'agt-deck' }, deckCommand)
  on('command.run', { command: 'agt-focus' }, focusCommand)
  on('command.run', { command: 'agt-highlight' }, highlightCommand)

  // Typed only. The worker gets it as a peer message over the wire; a Herdr worker without the
  // mod still gets it as a prompt.
  on('command.run', { command: 'agt-tell' }, async ($, e) => {
    if (!['composer', 'bridge'].includes(e.origin?.kind)) return { text: '/agt-tell runs only when typed.' }
    const t = await transportOf($)
    if (t !== 'none') await pollNow($, t)
    const a = parseTellArgs(e.args, S.panes)
    if (a.usage || a.error) return { text: a.usage ?? a.error }
    const rec = await $.store.get(statusKey(a.name)).catch(() => null)
    const sid = freshStatus(rec, a.name, Date.now()) ? validLead(rec.session) : null
    let sent = false
    if (sid) sent = (await $.session.send({ to: { sessionId: sid }, text: '[agt wire] lead note · ' + a.text }).catch(() => ({ isDelivered: false }))).isDelivered
    if (!sent && t === 'herdr') sent = (await $.process.run(herdrPromptArgv(a.name, a.text), PROBE).catch(() => null))?.exitCode === 0
    if (!sent) return { text: 'Could not reach ' + a.name + '.' }
    logWire(wireLog, { from: 'lead', to: shortName(a.name), kind: 'note', summary: a.text, at: Date.now() })
    $.ui.invalidate('ui.render')
    return { text: '⇄ sent to ' + a.name }
  })

  // The one place for read-only facts: settings in effect, routing, ledger and squads views, and a routing dry-run.
  on('command.run', { command: 'agt-info' }, async ($, e) => {
    const a = parseInfoArgs(e.args)
    if (a.error) return { text: a.error }
    if (a.view === 'routing') return { text: routingView() }
    if (a.view === 'ledger') return { text: ledgerView() }
    if (a.view === 'squads') return { text: await squadsView($) }
    if (a.view === 'route') return { text: routeText({ ...a, depth: a.depth ?? S.depth }, S.settings, S.weeklyPct) }
    await loadSquads($)
    const log = runs.get(S.lastRun)?.log ?? []
    return { text: overviewText({ display: S.display, squads: squadsSummary(S.squadRows), routing: routingSummary(log), ledger: ledgerSummary(ledger(live, S.lastRun, paneRoutes)) }) }
  })

  // Typed only: a plugin, a scheduled task or a notification never opens a pane.
  on('command.run', { command: 'agt-spawn' }, async ($, e) => {
    if (!['composer', 'bridge'].includes(e.origin?.kind)) return { text: '/agt-spawn runs only when typed.' }
    const a = parseSpawnArgs(e.args)
    if (a.usage || a.error) return { text: a.usage ?? a.error }
    const t = await transportOf($)
    if (t === 'none') return { text: 'No pane transport here: /agt-spawn needs Claude Code running inside Herdr or tmux.' }
    const run = newRunId()
    const name = paneName(run, SPAWN_ROLE)
    try {
      await openPane($, t, { run, name, model: a.model, task: a.task, cwd: await $.session.cwd() })
    } catch (err) {
      return { text: 'Could not open a ' + t + ' pane: ' + String(err?.message ?? err).slice(0, 160) }
    }
    openedNames.add(name)
    await savePanes($)
    ensurePolling($)
    return { text: 'Opened ' + name + ' · ' + a.model + ' · ' + t + ' pane.' }
  })

  on('tool.call', { tool: 'mcp__agentille__spawn_pane' }, spawnPane)
  on('tool.call', { tool: 'mcp__agentille__open_sessions' }, openSessions)
  on('tool.call', { tool: 'mcp__agentille__close_pane' }, closePane)
  on('tool.call', { tool: 'Bash' }, bashCall)  // guard.js: integration guard + worktree ownership

  on('command.run', { command: 'agt-clean' }, async ($, e) => {
    if (S.selfName || S.worker) return { text: 'agt clean runs in the lead session, not in a worker pane.' }
    return { text: cleanText(await cleanWorkspace($, { all: true })) }
  })

  // A typed /agt starts a clean run; a task notification, plugin or peer turn is not the person's prompt,
  // and neither is one whose origin the host did not name.
  on('prompt.submit', async ($, e, next) => {
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
    if (!typed) return next(e)
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
    if (S.rawTurn) return next({ ...e, context: [...(e.context ?? []), RAW_STYLE] })
    if (S.shapedTurn) return next({ ...e, context: [...(e.context ?? []), ANSWER_STYLE] })
    return next(e)
  })

  on('skill.prompt', async ($, e, next) => {
    if (!/(^|:)agt$/.test(e.skill)) return next(e)
    S.agtTurn = true
    const t = await transportOf($)
    if (t !== 'none') ensurePolling($)
    const draws = canDraw(await $.session.surfaces().catch(() => []))
    if (draws) await tipOnce($)
    return next({ ...e, text: e.text + S.squadBlock + transportBlock(t, S.paneTools && !S.selfName) + drawingBlock(draws) })
  })

  // Worker results arrive as peer messages: log them for the band and the deck, then let the
  // model read them (that delivery is what wakes the lead).
  on('session.receive', async ($, e, next) => {
    const w = parseWire(e.text)
    if (w) {
      const from = shortName(w.from)
      // Only the pane whose key the message names: a stale list or a respawned role must not harvest the older pane.
      const hit = w.kind === 'done' && w.key ? S.panes.find((p) => paneKey(p.id) === w.key && p.name === w.from) : null
      if (hit) { harvested.add(hit.id); wireDone.add(hit.id) }
      const route = w.kind === 'done' ? paneRoutes.findLast((r) => r.name === w.from) : null
      if (route) route.verdict = verdictChip(route.agent, w.summary)
      logWire(wireLog, { from, to: S.wireName ? shortName(S.wireName) : 'lead', kind: w.kind, summary: w.summary, at: Date.now() })
      $.ui.toast('⇄ ' + from + ' ' + w.kind)
      $.ui.invalidate('ui.render')
    }
    return next(e)
  })

  // What each agent is doing right now, for its band row: a subagent's call carries its agentId;
  // a worker pane's own main loop publishes for its lead. Observe only.
  on('tool.call', { tool: 'Write' }, async ($, e, next) => {
    const r = await next(e)
    if (!e.agentId && reportRun(e.file_path)) await completeReport($, e.file_path)
    return r
  })

  on('tool.call', async ($, e, next) => {
    if (e.agentId) {
      const a = live.get(e.agentId)
      if (a) {
        a.tool = toolLabel(e.tool, e)
        a.heard = Date.now()
      }
      // A workflow agent inside one long call (a full test suite) is alive: tree.js quietWorkflows
      // skips it until the call returns, and the return counts as heard.
      if (a?.workflow) {
        a.calls = (a.calls ?? 0) + 1
        try {
          return await next(e)
        } finally {
          a.calls -= 1
          a.heard = Date.now()
        }
      }
    } else if (S.wireName) {
      pub.tool = toolLabel(e.tool, e)
      void publish($).catch(() => {})
    }
    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    const week = e.rateLimits.find((r) => r.kind === 'seven_day')
    if (week) S.weeklyPct = week.percentUsed
    return next(e)
  })

  // Routing happens in dispatch.js; the redraw ticker is nudged here so dispatch.js needs no timer.
  on('agent.spawn', async ($, e, next) => {
    const res = await dispatchAgent($, e, next)
    ensureTicker($)
    return res
  })

  on('turn.step', async function* ($, e, next) {
    const a = e.agentId ? live.get(e.agentId) : undefined
    if (!e.agentId) S.leadModel = e.model
    const result = yield* next(a && a.routed ? { ...e, effort: a.effort } : e)
    if (!e.agentId && S.wireName && result?.usage) {
      const u = result.usage
      pub.tok += (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.output_tokens ?? 0)
      pub.model = e.model
      await publish($)
    }
    if (a) {
      a.heard = Date.now()
      if (!a.effort && e.effort) a.effort = String(e.effort)
      if (!a.model && e.model) a.model = e.model
      addUsage(a, result?.usage)
      $.ui.invalidate('ui.render')
    }
    return result
  })

  // A main-loop turn began (a subagent's run raises none). A worker's first one plays hello.
  on('turn.start', async ($, e, next) => {
    S.leadTurn = true
    if (e.agentId === undefined) S.lastAnswer = null
    if (S.worker) {
      const now = await $.clock.now()
      if (!mascot.greeted) {
        mascot.greeted = true
        mascot.hiUntil = now + HELLO_MS
        // tmux tags the pane name after the split, so the first poll can miss it: look once more.
        if (!S.selfName && S.transport && S.transport !== 'none') await pollNow($, S.transport)
      }
      mascot.working = true
      mascot.start = now
      ensureTicker($)
      $.ui.invalidate('ui.render')
    }
    if (S.wireName) {
      Object.assign(pub, { state: 'working', tool: null, start: Date.now(), ms: null })
      await publish($, true)
    }
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
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
    return next(e)
  })

  // The switchboard above the prompt and the deck pane: render.js draws both from the state.
  on('ui.render', { component: 'AbovePrompt' }, switchboard)
  on('ui.render', { component: 'Pane', requestId: DECK }, deck)

  // A long /agt reply: an essentials card on top, the body dim with its tokens lit. The
  // decision is memoised per message id so a reply does not restyle when a later turn changes.
  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    if (!litFor(litMemo, e.requestId, { on: S.highlightOn, agtTurn: S.agtTurn || S.highlightAll })) return next(e)
    const final = e.surface === 'terminal' && !e.props?.isSummary ? answerPanel(e.requestId, e.props?.text) : null
    if (rawIds.has(e.requestId)) return next(e)
    const h = final ? null : highlightFor(hlMemo, e.requestId, e.props?.text)
    if (!final && !h) return next(e)
    const els = $.ui.resolve(e)
    if (!els.Markdown) return next(e)
    if (final) return answerBox(els, final)
    const body = h.body !== null ? els.Markdown({ text: h.body, dimColor: true }) : await next(e)
    return els.Box({ flexDirection: 'column', children: h.card.length ? [cardBox(els, h.card), body] : [body] })
  })

  // Main-session spinner: how many subagents (◇) and pane sessions (▣) work behind it.
  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    if (live.has(e.requestId)) return next(e)
    const subs = [...live.values()].filter((a) => a.state === 'working').length
    const busy = S.panes.filter((p) => p.state === 'working').length
    if (subs + busy === 0) return next(e)
    // In an /agt run the status line holds the counts; the spinner names the phases at work.
    const phases = S.lastRun === 'adhoc' ? '' : runPhases(live, paneRoutes, S.lastRun)
    const parts = phases || [subs ? '◇' + subs : '', busy ? '▣' + busy : ''].filter(Boolean).join(' ') + ' working'
    return next({ ...e, props: { ...e.props, suffix: (e.props.suffix ?? '') + ' · ' + parts } })
  })

  registerRows(on, ctx)
  registerStatus(on, ctx)
  registerAutocomplete(on, ctx)
}
