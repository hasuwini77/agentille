// agentille mod entry: wires the hooks. The state is in state.js; routing, panes, sessions, the reaper, the
// timers, the worker's wire, display settings, drawing and run files each have a module beside this one.

import { S, ctx } from './state.js'
import { registerAutocomplete } from './autocomplete.js'
import { toolLabel, runPhases } from './board.js'
import { cleanText } from './clean.js'
import { demoteToast, runState, routingView, ledgerView, writeRunFile, writeReport, fileRunOf, completeReport, dispatchAgent } from './dispatch.js'
import { DECK, applyDisplay, addFlag, answerPanel, deckCommand, focusCommand, highlightCommand } from './display.js'
import { canDraw, drawingBlock, reportRun } from './drawing.js'
import { flagOf, flagKey } from './focus.js'
import { highlightFor, litFor, ANSWER_STYLE, isRawPrompt, RAW_STYLE } from './highlight.js'
import { parseInfoArgs, routeText, routingSummary, ledgerSummary, squadsSummary, overviewText } from './info.js'
import { pieceOf, verdictChip, party, taskLine, answerLine } from './links.js'
import { addUsage, finish, ledger, isAgtPrompt } from './live.js'
import { HELLO_MS, BYE_MS, parseWorker } from './mascot.js'
import { PROBE, SPAWN_ROLE, transportBlock, paneName, newRunId, doneFile, paneKey, answerFile, parseSpawnArgs, tmuxKillArgv, placePlan, codexNote, herdrPromptArgv, herdrCloseArgv, paneRole, spawnToolInput, closeTarget, sessionName, sessionsToolInput, sessionsNote } from './panes.js'
import { installedSkew, loadProfile, loadSquads, squadsView, tipOnce } from './profile.js'
import { pollNow, cleanWorkspace } from './reaper.js'
import { cardBox, answerBox, switchboard, deck } from './render.js'
import { formationOf, parseHeader, typedFable, proveHeader, demoteHeaderText, asksSessions, verdictOf, ladderFixes, decide } from './routing.js'
import { registerRows } from './rows.js'
import { saveSessions, closeSession, openSession } from './sessions.js'
import { skewMessage } from './skew.js'
import { detectTransport, transportOf, openPane, ensureTools } from './spawn.js'
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
      // One look now: a lead restarted mid-run sees its leftover panes. It reaps only those whose answer
      // was written after this look; an older one is flagged "not harvested" and left to the person.
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
    ensurePolling($)
    return { text: 'Opened ' + name + ' · ' + a.model + ' · ' + t + ' pane.' }
  })

  // /agt heavy level: the same openPane as /agt-spawn, with the input validated here.
  on('tool.call', { tool: 'mcp__agentille__spawn_pane' }, async ($, e) => {
    if (S.selfName || S.worker) return { deny: 'This is a worker pane (' + (S.selfName ?? S.worker.agent) + '); workers do not open panes.' }
    // An update since this session started leaves it on old code: its workers would never report.
    const skew = await installedSkew($)
    if (skew) {
      if (!S.skewToasted) $.ui.toast('agt ⚑ ' + skewMessage(skew, S.runningVersion))
      S.skewToasted = true
      return { deny: skewMessage(skew, S.runningVersion) }
    }
    const t = await transportOf($)
    if (t === 'none') return { deny: 'No pane transport here: run the slice as a subagent.' }
    if (!S.agtTyped) return { deny: 'spawn_pane opens worker panes only in a session where /agt was typed.' }
    const a = spawnToolInput(e, S.panes)
    if (a.error) return { deny: a.error }
    const proof = proveHeader(a.hdr, { fableTyped: S.fableTyped })
    if (proof.demoted) {
      a.hdr = proof.hdr
      a.header = demoteHeaderText(a.header)
      a.task = demoteHeaderText(a.task)
      demoteToast($, a.run)
    }
    const cwd = a.cwd ?? (await $.session.cwd())
    if (a.cwd) {
      const s = await $.fs.stat(cwd).catch(() => null)
      if (s?.kind !== 'dir') return { deny: cwd + ' is not a directory.' }
    }
    S.agtTurn = true
    S.lastRun = a.run
    const run = runState(a.run)
    run.formation = formationOf(a.hdr) ?? run.formation
    // Counted only once the pane opens: a failed split is not a fix attempt. The ladder sees this piece's rounds only.
    const isFix = a.agent === 'executor' && a.hdr.mode === 'fix'
    const fixKey = pieceOf(a.hdr) ?? ''
    const fixes = ladderFixes(run, pieceOf(a.hdr)) + (isFix ? 1 : 0)
    run.fable = Math.max(run.fable, Number((await $.store.get('fable:' + a.run)) ?? 0))
    const codex = a.vendor === 'codex'
    if (codex && t !== 'herdr') return { deny: 'Codex panes need Herdr; run this slice as a Claude pane or subagent.' }
    // Codex runs on the person's own config: no routed model or effort, no Fable count.
    const d = codex ? { model: 'codex', effort: '', reason: 'table', fable: false } : decide({ role: a.agent, hdr: a.hdr, run: { ...run, fixes }, depth: S.depth, settings: S.settings, weeklyPct: S.weeklyPct })
    const r = paneRole(a.agent)
    if (!r.pane) return { deny: r.why }
    await pollNow($, t)
    S.opened = S.opened.filter((o) => S.panes.some((p) => p.id === o.id))
    const lead = t === 'tmux' ? await $.env.get('TMUX_PANE') : await $.env.get('HERDR_PANE_ID')
    const plan = placePlan({ transport: t, layout: a.layout, run: a.run, lead, opened: S.opened, live: S.panes })
    // A respawned role (a fix round, a retry) must not inherit the earlier pane's done file: the SessionEnd sweep
    // and the tmux poll would read the new worker as finished and close it mid-slice.
    const stale = doneFile(S.home, a.run, a.role)
    if (stale) await $.process.run(['rm', '-f', stale], PROBE).catch(() => {})
    let id
    let tab
    try {
      const made = await openPane($, t, { run: a.run, name: a.name, agent: a.agent, vendor: a.vendor, model: d.model, effort: d.effort, task: a.task, cwd, newTab: !!plan.newTab, split: plan.newTab ? null : { target: plan.target, direction: plan.direction, tab: plan.tab } })
      id = made.id
      tab = made.tab
    } catch (err) {
      return { deny: 'Could not open a ' + t + ' pane: ' + String(err?.message ?? err).slice(0, 160) }
    }
    // A role can be respawned (a fix, a retry), and the multiplexer can hand the old pane's id out again. Harvest state is
    // keyed by pane id and the list call above may have failed, so wipe whatever the id carries: the new pane starts with
    // nothing harvested and only files written from now on count as its own.
    firstSeen.set(id, await $.clock.now())
    for (const s of [harvested, wireDone, woken, strandedToasted]) s.delete(id)
    paneSeen.delete(id)
    if (isFix) {
      run.fixes += 1
      run.fixesByPiece[fixKey] = (run.fixesByPiece[fixKey] ?? 0) + 1
    }
    if (d.fable) {
      run.fable += 1
      await $.store.set('fable:' + a.run, run.fable)
    }
    S.opened.push({ id, name: a.name, run: a.run, tab })
    openedNames.add(a.name)
    const piece = pieceOf(a.hdr)
    paneRoutes.push({ name: a.name, run: a.run, role: a.role, agent: a.agent, model: d.model, effort: d.effort, reason: d.reason, start: Date.now(), end: null, piece, verdict: null })
    logWire(wireLog, { from: 'lead', to: party(shortName(a.name), piece), kind: 'task', summary: taskLine(a.task) || a.agent, at: Date.now() })
    const rec = { at: new Date().toISOString(), role: a.agent, model: d.model, effort: d.effort, reason: d.reason, asked: a.asked, agentId: null, kind: 'pane', pane: a.name }
    decisions.push(rec)
    run.log.push(JSON.stringify(rec))
    await writeRunFile($, a.run, 'routing.jsonl', run.log.join('\n') + '\n')
    await pollNow($, t)
    ensurePolling($)
    ensureTicker($)
    if (d.reason !== 'table') $.ui.toast('agt ↑ ' + a.agent + ' → ' + d.model + ' · ' + d.effort + ' — ' + d.reason)
    return { result: 'Opened ' + a.name + ' · ' + d.model + (codex ? '' : ' · ' + d.effort) + ' · ' + t + ' pane.' + (d.reason === 'table' ? '' : ' (' + d.reason + ')') + (codex ? codexNote(a.name, answerFile(S.home, a.run, a.role, paneKey(id))) : '') }
  })

  // Sessions the person asked for: their own panes, like ones opened by hand. No worker env, no agt- name and no
  // wire, so the band, the reaper and the sweeps leave them alone; each one is a lead of its own.
  on('tool.call', { tool: 'mcp__agentille__open_sessions' }, async ($, e) => {
    if (S.selfName || S.worker) return { deny: 'This is a worker pane (' + (S.selfName ?? S.worker.agent) + '); workers do not open sessions.' }
    const skew = await installedSkew($)
    if (skew) {
      if (!S.skewToasted) $.ui.toast('agt ⚑ ' + skewMessage(skew, S.runningVersion))
      S.skewToasted = true
      return { deny: skewMessage(skew, S.runningVersion) }
    }
    const t = await transportOf($)
    if (t === 'none') return { deny: 'No pane transport here: sessions open as panes only inside Herdr or tmux.' }
    if (!S.sessionsAsked) return { deny: 'open_sessions runs only on a turn where the person typed a request for sessions, panes or terminals.' }
    const a = sessionsToolInput(e, { typed: S.lastTyped, fableTyped: typedFable(S.lastTyped) })
    if (a.error) return { deny: a.error }
    if (a.kind === 'codex' && t !== 'herdr') return { deny: 'Codex sessions need Herdr.' }
    const cwd = a.cwd ?? (await $.session.cwd())
    if (a.cwd) {
      const s = await $.fs.stat(cwd).catch(() => null)
      if (s?.kind !== 'dir') return { deny: cwd + ' is not a directory.' }
    }
    const run = newRunId()
    const tab = t === 'herdr' && a.layout === 'tab'
    const names = []
    let prev = null
    let failed = null
    for (let n = 0; n < a.count; n++) {
      const name = sessionName(run, n + 1)
      // Each session goes under the one before it; a stacked call starts under the newest stacked session.
      const after = prev ?? (tab ? null : S.sessions.filter((x) => !x.tab).at(-1) ?? null)
      try {
        prev = await openSession($, t, { name, kind: a.kind, model: a.model, task: a.tasks[n], cwd, after, newTab: tab && !prev })
      } catch (err) {
        failed = String(err?.message ?? err).slice(0, 160)
        break
      }
      S.sessions.push(prev)
      names.push(name)
    }
    if (!names.length) return { deny: 'Could not open a ' + t + ' pane: ' + failed }
    if (t === 'herdr') await saveSessions($)
    ensurePolling($)
    const what = a.kind === 'claude' ? 'Claude' + (a.model ? ' · ' + a.model : '') : a.kind === 'codex' ? 'Codex' : 'shell'
    const stop = failed ? ' Session ' + (names.length + 1) + ' failed: ' + failed : ''
    return { result: 'Opened ' + names.join(', ') + ' · ' + what + ' · ' + t + (names.length > 1 ? ' panes.' : ' pane.') + stop + sessionsNote(t, a.kind) }
  })

  on('tool.call', { tool: 'mcp__agentille__close_pane' }, async ($, e) => {
    if (S.selfName || S.worker) return { deny: 'This is a worker pane (' + (S.selfName ?? S.worker.agent) + '); workers do not close panes.' }
    const t = await transportOf($)
    if (t === 'none') return { deny: 'No pane transport here.' }
    const s = S.sessions.find((x) => x.name === (typeof e.name === 'string' ? e.name.trim() : ''))
    if (s) {
      const c = await closeSession($, t, s)
      if (c === 'failed') return { deny: 'Could not close ' + s.name + '.' }
      return { result: c === 'closed' ? 'Closed ' + s.name + '.' : s.name + ' is already closed.' }
    }
    await pollNow($, t)
    const c = closeTarget(e, S.panes, t === 'herdr' && S.selfTab ? [S.selfTab, ...ownedTabs] : null, openedNames)
    if (c.gone) return { result: c.gone + ' is already closed (the reaper closed it after its answer was saved).' }
    if (c.error) return { deny: c.error }
    const r = await $.process.run(t === 'herdr' ? herdrCloseArgv(c.pane.id) : tmuxKillArgv(c.pane.id), PROBE).catch(() => null)
    if (!r || r.exitCode !== 0) return { deny: 'Could not close ' + c.pane.name + '.' }
    harvested.add(c.pane.id)
    await pollNow($, t)
    return { result: 'Closed ' + c.pane.name + '.' }
  })

  on('command.run', { command: 'agt-clean' }, async ($, e) => {
    if (S.selfName || S.worker) return { text: 'agt clean runs in the lead session, not in a worker pane.' }
    return { text: cleanText(await cleanWorkspace($, { all: true })) }
  })

  // A typed /agt starts a clean run; a task notification, plugin or peer turn is not the person's prompt.
  on('prompt.submit', async ($, e, next) => {
    const k = e.origin?.kind
    if (k !== undefined && k !== 'composer' && k !== 'bridge') return next(e)
    S.lastTyped = String(e.text ?? '')
    S.agtTurn = isAgtPrompt(e.text)
    if (S.agtTurn) S.flags = []   // a new run starts with a clean slate
    // What the person typed is the only proof the dispatch headers get: a typed /agt unlocks spawn_pane
    // for the session, --fable on it is what makes fable=forced hold, and only a typed ask opens sessions.
    if (S.agtTurn) { S.agtTyped = true; S.fableTyped = typedFable(e.text) }
    if (S.agtTurn) await ensureTools($, 'panes')
    // A worker's proof is its first prompt: the lead already rewrote fable=forced there when nobody typed --fable.
    if (S.worker && !S.workerProved) { S.workerProved = true; S.fableTyped = parseHeader(e.text)?.fable === 'forced' || typedFable(e.text) }
    S.sessionsAsked = !S.agtTurn && !S.selfName && !S.worker && asksSessions(e.text)
    if (S.sessionsAsked) await ensureTools($, 'sessions')
    if (S.agtTurn && S.deckAuto) void $.ui.open({ id: DECK, title: 'agentille' })
    // Under display.highlight: all, a typed question in the lead session asks for the panel's shape.
    // Never in a worker pane (the lead parses its report) and never for a slash command or an /agt run.
    const typed = !S.agtTurn && !S.selfName && !S.worker && !String(e.text ?? '').trimStart().startsWith('/')
    // Asked for text to paste as is: no panel and no answer style. Under display.highlight: off nothing is
    // added to any prompt and nothing is copied, so the raw style needs highlight on or all.
    S.rawTurn = typed && S.highlightOn && isRawPrompt(e.text)
    S.shapedTurn = !S.rawTurn && typed && S.highlightOn && S.highlightAll
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
      // and what the run leaves behind is tidied (finished orphans, merged worktrees).
      if (S.agtTurn && !S.selfName && !S.worker && /^[✓✗]/.test(e.answer.trimStart())) {
        S.flags = []
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
