// agentille mod entry: wires the hooks. The state is in state.js; routing, panes, sessions, the reaper, the
// timers, the worker's wire, display settings, drawing and run files each have a module beside this one.

import { S, ctx, isLead, Profile, Display, Runs, Spawn } from './state.js'
import { registerAutocomplete } from './autocomplete.js'
import { toolLabel, runPhases } from './board.js'
import { cleanText } from './clean.js'
import { routingView, ledgerView, completeReport, dispatchAgent } from './dispatch.js'
import { DECK, applyDisplay, answerPanel, deckCommand, focusCommand, highlightCommand, setStoredRaw, setLastAnswer, mascotHello, mascotWorking } from './display.js'
import { canDraw, drawingBlock, reportRun } from './drawing.js'
import { highlightFor, litFor } from './highlight.js'
import { parseInfoArgs, routeText, routingSummary, ledgerSummary, squadsSummary, overviewText } from './info.js'
import { verdictChip } from './links.js'
import { addUsage, ledger } from './live.js'
import { parseWorker } from './mascot.js'
import { PROBE, SPAWN_ROLE, transportBlock, paneName, newRunId, paneKey, parseSpawnArgs, herdrPromptArgv } from './panes.js'
import { installedSkew, loadProfile, loadSquads, squadsView, tipOnce } from './profile.js'
import { bashCall } from './guard.js'
import { pollNow, cleanWorkspace } from './reaper.js'
import { cardBox, answerBox, switchboard, deck } from './render.js'
import { registerRows } from './rows.js'
import { hostMessage, hostTooOld, hostVersionOf, skewMessage } from './skew.js'
import { probeTransport, transportOf, openPane, loadOwned, savePanes, ownName } from './spawn.js'
import { spawnPane, openSessions, closePane } from './tools.js'
import { registerStatus } from './status.js'
import { refreshAgents, working, ensurePolling, ensureTicker } from './ticker.js'
import { statusKey, freshStatus, validLead, parseWire, shortName, parseTellArgs } from './wire.js'
import { publish, noteWire, pubRoute, pubTool, pubStep, pubWorking } from './worker.js'
import { onPromptSubmit, onTurnComplete } from './turns.js'
import { dispatchedRun, agtTurnFromDispatch } from './proofs.js'
import { parseHeader, roleOf } from './routing.js'
import * as P from './panerec.js'

// Per message id, whether a reply is lit and its highlight: only the AssistantMessage render below reads them.
const litMemo = new Map()
const hlMemo = new Map()

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
    await probeTransport($)
    S.worker = parseWorker(await $.env.get('AGENTILLE_WORKER'))
    S.sessionId = validLead(await $.session.id().catch(() => null))
    S.wireName = /^agt-[A-Za-z0-9_-]+$/.test((await $.env.get('AGENTILLE_NAME')) ?? '') ? await $.env.get('AGENTILLE_NAME') : null
    S.leadSession = S.wireName ? validLead(await $.env.get('AGENTILLE_LEAD')) : null
    if (S.worker) pubRoute(S.worker.model, S.worker.effort)
    await $.command.register({ name: 'agt-deck', description: 'Open the agentille deck: the cast, routing timeline, wire log and tokens. auto = open on every /agt (saved as display.deck) · off', argumentHint: '[auto|off]', immediate: true })
    await $.command.register({ name: 'agt-tell', description: 'Send a message to a worker pane over the wire', argumentHint: '<worker> <message>', immediate: true })
    await $.command.register({ name: 'agt-spawn', description: 'Open a routed claude pane beside this one (Herdr or tmux); it closes itself once its answer is saved', argumentHint: '"task" [--model sonnet|opus|haiku|fable]' })
    setStoredRaw({
      deckAuto: await $.store.get('deck:auto'),
      focusMode: await $.store.get('focus:mode'),
      highlightOn: await $.store.get('highlight:on'),
      highlightAll: await $.store.get('highlight:all'),
    })
    applyDisplay()
    await $.command.register({ name: 'agt-info', description: 'Settings in effect, routing, ledger, squads, or a route dry-run: routing | ledger | squads | route <role>', argumentHint: '[routing|ledger|squads|route <role> [size=…] [risk=…] [depth=…]]', immediate: true })
    await $.command.register({ name: 'agt-highlight', description: 'Highlight replies: on (/agt replies lit; a paste-ready ask gets a plain-text note) · all (every typed question gets the answer shape) · off (nothing added to any prompt). Saved as display.highlight in profile.json; goes away in v4', argumentHint: '[on|all|off]', immediate: true })
    await $.command.register({ name: 'agt-clean', description: 'Tidy up now: close finished agt panes, remove merged agt/* worktrees and branches this session\'s runs made, drop run folders untouched for 14 days. Anything still working, unmerged or made elsewhere stays', immediate: true })
    await $.command.register({ name: 'agt-focus', description: 'Agent flags above the prompt (a REVISE, a FAIL, a blocked pane): on · off. Saved as display.focus in profile.json; goes away in v4', argumentHint: '[on|off]', immediate: true })
    if (Spawn.transport !== 'none') {
      // One look now: a lead restarted mid-run takes back the panes it opened (lead-<pane>.panes) and no other
      // session's. It reaps only those whose answer was written after this look; an older one is flagged
      // "not harvested" and left to the person. A session that opened none polls nothing.
      await loadOwned($)
      await pollNow($, Spawn.transport)
      if (S.panes.length) ensurePolling($)
      // A lead that died skipped its SessionEnd sweep: close its finished workers now.
      if (S.panes.length && isLead()) void cleanWorkspace($, { auto: true, panesOnly: true }).catch(() => {})
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
    noteWire({ from: 'lead', to: shortName(a.name), kind: 'note', summary: a.text, at: Date.now() })
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
    if (a.view === 'route') return { text: routeText({ ...a, depth: a.depth ?? Profile.depth }, Profile.settings, S.weeklyPct) }
    await loadSquads($)
    const log = Runs.runs.get(Runs.lastRun)?.log ?? []
    return { text: overviewText({ display: Display.display, squads: squadsSummary(Profile.squadRows), routing: routingSummary(log), ledger: ledgerSummary(ledger(Runs.live, Runs.lastRun, Runs.paneRoutes)) }) }
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
    ownName(name)
    await savePanes($)
    ensurePolling($)
    return { text: 'Opened ' + name + ' · ' + a.model + ' · ' + t + ' pane.' }
  })

  on('tool.call', { tool: 'mcp__agentille__spawn_pane' }, spawnPane)
  on('tool.call', { tool: 'mcp__agentille__open_sessions' }, openSessions)
  on('tool.call', { tool: 'mcp__agentille__close_pane' }, closePane)
  on('tool.call', { tool: 'Bash' }, bashCall)  // guard.js: integration guard + worktree ownership

  on('command.run', { command: 'agt-clean' }, async ($, e) => {
    if (!isLead()) return { text: 'agt clean runs in the lead session, not in a worker pane.' }
    return { text: cleanText(await cleanWorkspace($, { all: true })) }
  })

  // A typed /agt starts a clean run, and the turn's proofs are set or dropped: turns.js.
  on('prompt.submit', async ($, e, next) => next(await onPromptSubmit($, e)))

  on('skill.prompt', async ($, e, next) => {
    if (!/(^|:)agt$/.test(e.skill)) return next(e)
    agtTurnFromDispatch()
    const t = await transportOf($)
    if (t !== 'none') ensurePolling($)
    const draws = canDraw(await $.session.surfaces().catch(() => []))
    if (draws) await tipOnce($)
    return next({ ...e, text: e.text + Profile.squadBlock + transportBlock(t, Spawn.paneTools && isLead()) + drawingBlock(draws) })
  })

  // Worker results arrive as peer messages: log them for the band and the deck, then let the
  // model read them (that delivery is what wakes the lead).
  on('session.receive', async ($, e, next) => {
    const w = parseWire(e.text)
    if (w) {
      const from = shortName(w.from)
      // Only the pane whose key the message names: a stale list or a respawned role must not harvest the older pane.
      const hit = w.kind === 'done' && w.key ? S.panes.find((p) => paneKey(p.id) === w.key && p.name === w.from) : null
      if (hit) { const r = P.rec(hit.id); r.harvested = true; r.wireDone = true }
      const route = w.kind === 'done' ? Runs.paneRoutes.findLast((r) => r.name === w.from) : null
      if (route) route.verdict = verdictChip(route.agent, w.summary)
      noteWire({ from, to: S.wireName ? shortName(S.wireName) : 'lead', kind: w.kind, summary: w.summary, at: Date.now() })
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
      const a = Runs.live.get(e.agentId)
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
      pubTool(toolLabel(e.tool, e))
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
    if (!res?.deny && roleOf(e.subagentType)) dispatchedRun(parseHeader(e.prompt)?.run)
    ensureTicker($)
    return res
  })

  on('turn.step', async function* ($, e, next) {
    const a = e.agentId ? Runs.live.get(e.agentId) : undefined
    if (!e.agentId) S.leadModel = e.model
    const result = yield* next(a && a.routed ? { ...e, effort: a.effort } : e)
    if (!e.agentId && S.wireName && result?.usage) {
      pubStep(result.usage, e.model)
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
    if (e.agentId === undefined) setLastAnswer(null)
    if (S.worker) {
      const now = await $.clock.now()
      if (mascotHello(now)) {
        // tmux tags the pane name after the split, so the first poll can miss it: look once more.
        if (!S.selfName && Spawn.transport && Spawn.transport !== 'none') await pollNow($, Spawn.transport)
      }
      mascotWorking(now)
      ensureTicker($)
      $.ui.invalidate('ui.render')
    }
    if (S.wireName) {
      pubWorking()
      await publish($, true)
    }
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    await onTurnComplete($, e)
    return next(e)
  })

  // The switchboard above the prompt and the deck pane: render.js draws both from the state.
  on('ui.render', { component: 'AbovePrompt' }, switchboard)
  on('ui.render', { component: 'Pane', requestId: DECK }, deck)

  // A long /agt reply: an essentials card on top, the body dim with its tokens lit. The
  // decision is memoised per message id so a reply does not restyle when a later turn changes.
  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    if (!litFor(litMemo, e.requestId, { on: Display.highlightOn, agtTurn: S.agtTurn || Display.highlightAll })) return next(e)
    const final = e.surface === 'terminal' && !e.props?.isSummary ? answerPanel(e.requestId, e.props?.text) : null
    if (Display.rawIds.has(e.requestId)) return next(e)
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
    if (Runs.live.has(e.requestId)) return next(e)
    const subs = [...Runs.live.values()].filter((a) => a.state === 'working').length
    const busy = S.panes.filter((p) => p.state === 'working').length
    if (subs + busy === 0) return next(e)
    // In an /agt run the status line holds the counts; the spinner names the phases at work.
    const phases = Runs.lastRun === 'adhoc' ? '' : runPhases(Runs.live, Runs.paneRoutes, Runs.lastRun)
    const parts = phases || [subs ? '◇' + subs : '', busy ? '▣' + busy : ''].filter(Boolean).join(' ') + ' working'
    return next({ ...e, props: { ...e.props, suffix: (e.props.suffix ?? '') + ' · ' + parts } })
  })

  registerRows(on, ctx)
  registerStatus(on, ctx)
  registerAutocomplete(on, ctx)
}
