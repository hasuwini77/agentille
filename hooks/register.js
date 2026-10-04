// agentille mod — routing, the live view, squads, the pane reaper (herdr and tmux) and focus.
// Policy and state live in routing.js / live.js / squads.js / sprites.js / focus.js; this file
// observes events, applies decisions, and draws.

import { DEFAULTS, decide, formationOf, parseHeader, roleOf, verdictOf } from './routing.js'
import { addUsage, ageFarewells, effortBar, elapsed, endRoute, endsOnQuestion, finish, isAgtPrompt, ledger, ledgerText, newAgent, newTracker, paneAgents, paneByes, playing, reapable, reopenOnReply, shouldAutoOpen, short, stage, stripText, tokens } from './live.js'
import { activeSquads, allPaths, depsOf, injection } from './squads.js'
import { cells, hatOf, MODEL_COLOR, modelKey } from './sprites.js'
import { MARK, SPAN_COLOR, highlight, highlightText, litFor, parseHighlightArgs, spans } from './highlight.js'
import { BRIEF_SYSTEM, DEFAULT_FOCUS, briefPrompt, flagOf, focusText, paneFlags, parseBrief, parseFocusArgs, shouldBrief } from './focus.js'
import {
  CLOSE_TOOL, HERDR_START_TIMEOUT, PROBE, SPAWN_TOOL, closeTarget, spawnToolInput, SAFE_RUN, SPAWN_ROLE, TMUX_LIST_ARGV, doneFile, herdrCloseArgv, herdrPaneIdOf, herdrPromptArgv, herdrSplitArgv, herdrStartArgv,
  isFreshDone, isLead, newRunId, paneName, paneRole, parseSpawnArgs, parseTmuxList, pickTransport, quietSpawn, reapPool, scopeRows, splitName, splitPlan, tmuxEvenArgv, tmuxKillArgv, tmuxPaneAgents, tmuxPaneIdOf,
  tmuxWidthArgv, widthOf, teamDirective, teamForce, teamNotice, tmuxSplitArgv, tmuxTagArgvs, transportBlock,
} from './panes.js'

const DECK = 'agt-deck'
const hex = (n) => '#' + n.toString(16).padStart(6, '0')

let settings = { ...DEFAULTS }
let depth = null
let home = null
let weeklyPct = null
let lastRun = 'adhoc'
const runs = new Map()       // run id → { revise, fixes, fable, log: [] }
const live = new Map()       // agentId → live agent (live.js)
const decisions = []         // this session, for /agt-routing
let panes = []               // agt-* panes (herdr or tmux) other than this one
const paneRoutes = []        // PaneRoute[], append-only: how each worker this lead opened was routed
let opened = []              // { id, name, axis } of panes this lead opened via spawn_pane, in spawn order
const tracker = newTracker() // who is on stage and who is waving goodbye (live.js)
const paneSeen = new Map()   // reaper bookkeeping
const tmuxFirstSeen = new Map() // tmux pane id → when this session first listed it
let selfName = null          // this pane's name when it is an agt-* worker
let selfTab = null           // herdr: the lead's own tab, where its workers split
let paneTools = false        // spawn_pane / close_pane registered for this lead
let squads = []              // active squads for this repo
let squadBlock = ''
let pendingForce = null     // { template } from the last typed forced team, until the next agt skill.prompt
let transport = null        // 'herdr' | 'tmux' | 'none', probed once at session start
let deckOpen = false
let deckAuto = true          // open the deck on its own when a run starts
let deckDismissedRun = null  // run whose deck the person closed by hand
let deckWaiting = null       // { at, spawned }: a typed /agt whose first agent has not come yet
let deckBy = null            // 'auto' | 'person': who opened the deck; a person's deck is never closed for them
let closeAfterBye = null     // { asked }: close the deck once the last farewell has played
let tick = 0
let pollTimer = null         // pane polling: runs only while panes may exist
let quietPolls = 0
let tickTimer = null         // redraw ticker: runs only while something works
let focusMode = DEFAULT_FOCUS
let brief = []               // [{ kind, text }] for the latest long answer
let briefSeq = 0
let flags = []               // [{ text, at }] from agent results this run
let agtTurn = false          // this turn is part of an /agt run
let highlightOn = true       // /agt replies get an essentials card and lit tokens
const litMemo = new Map()    // message id → was it an /agt turn when first drawn
const FLAG_TTL_MS = 30 * 60_000
const FOCUS_COLOR = { next: '#3fb950', flag: '#f85149' }

function runState(id) {
  if (!runs.has(id)) runs.set(id, { revise: 0, fixes: 0, fable: 0, formation: null, log: [] })
  return runs.get(id)
}

async function probeOk($, argv) {
  try {
    return (await $.process.run(argv, PROBE)).exitCode === 0
  } catch {
    return false
  }
}

// herdr → tmux → none. A probe that rejects or exits non-zero counts as unavailable; so
// does a host with no $.process (desktop app, VS Code), where the call itself throws.
async function detectTransport($) {
  const herdrOk = (await $.env.get('HERDR_ENV')) === '1' && (await probeOk($, ['herdr', '--version']))
  const tmuxOk = !herdrOk && ((await $.env.get('TMUX')) ?? '') !== '' && (await probeOk($, ['tmux', '-V']))
  return pickTransport({ herdrOk, tmuxOk })
}

async function transportOf($) {
  transport ??= await detectTransport($)
  return transport
}

function shortType(t) {
  return String(t ?? 'agent').split(':').pop()
}

async function loadProfile($) {
  home = (await $.env.get('HOME')) ?? null
  if (!home) return
  try {
    const p = JSON.parse(await $.fs.read(home + '/.agentille/profile.json'))
    depth = p.thinkingDepth ?? null
    settings = { ...DEFAULTS, ...(p.routing ?? {}) }
  } catch {
    // no profile yet: /agt itself tells the user to run /agentille-init
  }
}

async function loadSquads($) {
  try {
    const config = JSON.parse(await $.fs.read($.plugin.root + '/.claude-plugin/squads.json'))
    const cwd = await $.session.cwd()
    let pkg = ''
    try { pkg = await $.fs.read(cwd + '/package.json') } catch { /* not a node repo */ }
    const existing = new Set()
    for (const p of allPaths(config)) if (await $.fs.exists(cwd + '/' + p)) existing.add(p)
    squads = activeSquads(config, depsOf(pkg), existing)
    squadBlock = injection(squads)
  } catch {
    squads = []
    squadBlock = ''
  }
}

// Open the deck on the person's behalf. No focus: the prompt keeps the keys.
async function autoDeck($) {
  if (!shouldAutoOpen({ auto: deckAuto, open: deckOpen, dismissedRun: deckDismissedRun, run: lastRun })) return
  deckOpen = true
  try {
    await $.ui.open({ id: DECK, title: 'agentille deck', closeOnEscape: true })
    deckBy = 'auto'
  } catch {
    deckOpen = false
  }
}

async function writeRunFile($, runId, name, text) {
  if (!home || !SAFE_RUN.test(runId) || runId === 'adhoc') return
  try {
    await $.fs.write(home + '/.agentille/state/run-' + runId + '/' + name, text)
  } catch {
    // the run dir is the orchestrator's; logging never blocks a dispatch
  }
}

const busy = () => working() || playing({ agents: live, tracker })

// Close the deck we opened, never one the person opened. A question keeps the strip waiting
// for the reply, but only if there was a deck (or a wait) to bring back.
async function closeDeck($, asked) {
  const had = deckOpen || !!deckWaiting
  if (deckOpen && deckBy !== 'person') {
    deckOpen = false
    deckBy = null
    await $.ui.close({ id: DECK }).catch(() => {})
  }
  deckWaiting = asked && had ? { at: Date.now() } : null
}

// The main turn ended: close the deck once nothing works and no farewell is still playing.
async function endOfTurn($, asked) {
  if (working()) return // a later idle turn end closes it
  if (deckBy === 'person') return
  if (playing({ agents: live, tracker })) {
    closeAfterBye = { asked }
    ensureTicker($)
    return
  }
  await closeDeck($, asked)
}

// Panes that left the stage this poll: end their route, refresh the ledger, start the wave.
async function notePaneByes($) {
  const left = paneByes(tracker, panes)
  const touched = new Set()
  for (const name of left) {
    const r = endRoute(paneRoutes, name, Date.now())
    if (r) touched.add(r.run)
  }
  for (const run of touched) await writeRunFile($, run, 'ledger.json', JSON.stringify(ledger(live, run, paneRoutes), null, 2) + '\n')
  if (left.length) ensureTicker($)
}

async function pollHerdr($) {
  let list = []
  try {
    const r = await $.process.run(['herdr', 'agent', 'list'])
    list = JSON.parse(r.stdout).result?.agents ?? []
  } catch {
    return
  }
  const selfPane = (await $.env.get('HERDR_PANE_ID')) ?? null
  const me = list.find((p) => p.pane_id === selfPane)
  selfName = me && typeof me.name === 'string' && me.name.startsWith('agt-') ? me.name : null
  selfTab = me?.tab_id ?? null
  // Show the workspace's agt-* panes; reap only the lead's own tab, where herdr mode
  // splits its workers. Workers (panes that are themselves agt-*) never reap.
  panes = quietSpawn(paneAgents(list, selfPane).filter((p) => !me || p.workspace === me.workspace_id))
  await notePaneByes($)
  if (me && !selfName) {
    const mine = panes.filter((p) => p.tab === me.tab_id)
    for (const p of reapable(reapPool(mine), paneSeen, await $.clock.now())) {
      try {
        await $.process.run(['herdr', 'pane', 'close', p.id])
        $.ui.toast('agt reaped ' + p.name + ' (' + p.state + ')')
      } catch {
        // a pane closed by hand in the meantime is fine
      }
    }
  }
  $.ui.invalidate('ui.render')
}

async function runOk($, argv, init) {
  const r = await $.process.run(argv, init)
  if (r.exitCode !== 0) throw new Error(argv.slice(0, 3).join(' ') + ' exited ' + r.exitCode)
  return r
}

// One claude pane beside this one, named agt-<run>-<role>, never focused. A half-made
// pane is closed again before the error goes up. `split` stacks it beside an earlier worker
// instead of the lead. Returns the new pane id.
async function openPane($, t, o) {
  if (t === 'tmux') {
    const lead = await $.env.get('TMUX_PANE')
    if (!lead) throw new Error('TMUX_PANE is not set')
    const target = o.split?.target ?? lead
    const shell = (await $.env.get('SHELL')) ?? ''
    const id = tmuxPaneIdOf((await runOk($, tmuxSplitArgv({ ...o, target, shell, direction: o.split?.direction }), PROBE)).stdout)
    if (!id) throw new Error('tmux gave no pane id')
    try {
      for (const argv of tmuxTagArgvs(id, o.name)) await runOk($, argv, PROBE)
    } catch (err) {
      await $.process.run(tmuxKillArgv(id), PROBE).catch(() => {})
      throw err
    }
    // Even out the stack; a cosmetic failure never loses the worker.
    if (o.split && o.split.target !== lead) await $.process.run(tmuxEvenArgv(id), PROBE).catch(() => {})
    return id
  }
  const lead = await $.env.get('HERDR_PANE_ID')
  if (!lead) throw new Error('HERDR_PANE_ID is not set')
  const pane = o.split?.target ?? lead
  const id = herdrPaneIdOf((await runOk($, herdrSplitArgv({ pane, cwd: o.cwd, run: o.run, direction: o.split?.direction }), PROBE)).stdout)
  if (!id) throw new Error('herdr gave no pane id')
  try {
    await runOk($, herdrStartArgv({ name: o.name, pane: id, model: o.model, effort: o.effort }), HERDR_START_TIMEOUT)
    await runOk($, herdrPromptArgv(o.name, o.task), PROBE)
  } catch (err) {
    await $.process.run(herdrCloseArgv(id), PROBE).catch(() => {})
    throw err
  }
  return id
}

// tmux has no agent status, so a pane is working until its done-file appears or tmux
// calls it dead. Panes are scoped to the lead's own window; only an unnamed lead reaps,
// and tmux has no idle state, so only the 90s done grace applies.
async function pollTmux($) {
  let rows = []
  try {
    const r = await $.process.run(TMUX_LIST_ARGV, PROBE)
    if (r.exitCode !== 0) return
    rows = parseTmuxList(r.stdout)
  } catch {
    return
  }
  const selfPane = (await $.env.get('TMUX_PANE')) ?? null
  const me = rows.find((r) => r.id === selfPane)
  selfName = me && me.agt.startsWith('agt-') ? me.agt : null
  // Window-scope first: no file is read for a pane this lead does not own. A done-file counts
  // only if it was written after the pane was first listed.
  const now = await $.clock.now()
  const scoped = me ? scopeRows(rows, selfPane) : []
  for (const r of scoped) if (!tmuxFirstSeen.has(r.id)) tmuxFirstSeen.set(r.id, now)
  for (const id of [...tmuxFirstSeen.keys()]) if (!rows.some((r) => r.id === id)) tmuxFirstSeen.delete(id)
  const done = new Map()
  for (const r of scoped) {
    const n = splitName(r.agt)
    const file = n && n.role !== SPAWN_ROLE && !r.dead && doneFile(home, n.run, n.role)
    if (!file) continue
    try {
      done.set(r.agt, isFreshDone(await $.fs.stat(file), tmuxFirstSeen.get(r.id)))
    } catch {
      // missing or unreadable counts as not done
    }
  }
  panes = tmuxPaneAgents(rows, selfPane, done)
  await notePaneByes($)
  if (isLead(rows, selfPane)) {
    for (const p of reapable(reapPool(panes), paneSeen, now)) {
      try {
        await $.process.run(tmuxKillArgv(p.id), PROBE)
        $.ui.toast('agt reaped ' + p.name + ' (' + p.state + ')')
      } catch {
        // a pane closed by hand in the meantime is fine
      }
    }
  }
  $.ui.invalidate('ui.render')
}

async function pollNow($, t) {
  if (t === 'herdr') await pollHerdr($)
  else if (t === 'tmux') await pollTmux($)
}

const working = () => [...live.values()].some((a) => a.state === 'working') || panes.some((p) => p.state === 'working')

// Pane polling starts when panes can exist (an /agt run, a spawn, panes found at start) and
// stops after a minute with no agt- pane and nothing working.
function ensurePolling($) {
  if (pollTimer || !transport || transport === 'none') return
  quietPolls = 0
  pollTimer = $.clock.every(5000, () => {
    pollNow($, transport).then(() => {
      if (panes.length || busy()) { quietPolls = 0; ensureTicker($); return }
      if (++quietPolls >= 12) { pollTimer?.cancel(); pollTimer = null }
    })
  })
}

// Redraw while something works or waves goodbye (elapsed times tick, deck sprites bob); stop once idle.
function ensureTicker($) {
  if (tickTimer) return
  tickTimer = $.clock.every(600, () => {
    const still = ageFarewells({ agents: live, tracker })
    if (!working() && !still) {
      tickTimer?.cancel()
      tickTimer = null
      if (closeAfterBye) {
        const { asked } = closeAfterBye
        closeAfterBye = null
        closeDeck($, asked)
      }
    } else tick ^= 1
    $.ui.invalidate('ui.render')
  })
}

function addFlag($, text) {
  if (!text) return
  const now = Date.now()
  flags = flags.filter((f) => now - f.at < FLAG_TTL_MS && f.text !== text)
  flags.push({ text, at: now })
  $.ui.toast('agt ⚑ ' + text)
}

function focusLines(now) {
  const fresh = flags.filter((f) => now - f.at < FLAG_TTL_MS).map((f) => f.text)
  return [...[...fresh, ...paneFlags(panes)].map((text) => ({ kind: 'flag', text })), ...brief.filter((b) => b.kind !== 'flag'), ...brief.filter((b) => b.kind === 'flag')].slice(0, 5)
}

// One Text per essentials item: a coloured mark, then the line with paths, versions and numbers lit.
function cardBox(els, items) {
  const { Box, Text } = els
  return Box({
    flexDirection: 'column',
    children: items.map((item) => {
      const color = FOCUS_COLOR[item.kind]
      return Text({
        ...(color ? { color } : { dimColor: true }),
        wrap: 'truncate',
        children: [
          Text({ ...(color ? { color } : { dimColor: true }), children: [MARK[item.kind] + ' '] }),
          ...spans(item.text).map((sp) => (sp.kind === 'plain' ? sp.text : Text({ color: SPAN_COLOR[sp.kind], children: [sp.text] }))),
        ],
      })
    }),
  })
}

function focusRow(els, line) {
  const mark = { next: '→', flag: '⚑', done: '✓' }[line.kind]
  const color = FOCUS_COLOR[line.kind]
  return els.Text({ ...(color ? { color } : { dimColor: true }), wrap: 'truncate', children: [mark + ' ' + line.text] })
}

// ── drawing helpers (take resolved elements, never $) ─────────────────────────

function modelText(Text, a) {
  if (a.kind === 'pane' && !a.model) return Text({ color: hex(MODEL_COLOR.other), children: [(a.vendor + ' pane').padEnd(15)] })
  const m = short(a.model)
  const label = (m === 'other' ? shortType(a.model).slice(0, 6) : m) + ' ' + effortBar(a.effort) + ' ' + (a.effort ?? '')
  return Text({ color: hex(MODEL_COLOR[modelKey(a.model)]), children: [label.padEnd(15)] })
}

function stateText(a, now) {
  if (a.bye > 0) return 'bye!'.padEnd(13)
  if (a.kind === 'pane') return a.state === 'working' && a.start ? ('working ' + elapsed(now - a.start).padStart(5)) : a.state.padEnd(13)
  const t = elapsed((a.end ?? now) - a.start)
  return (a.state === 'working' ? 'working ' : 'done    ') + t.padStart(5)
}

function row(els, a, now) {
  const { Box, Text } = els
  const working = a.state === 'working'
  const leaving = a.bye > 0
  const glyph = leaving ? '✓' : a.kind === 'pane' ? '▣' : working ? '●' : '✓'
  const color = hex(MODEL_COLOR[modelKey(a.model)])
  const kids = [
    Text({ color, children: [glyph] }),
    Text({ dimColor: !working && !leaving, children: [a.role.slice(0, 18).padEnd(18)] }),
    modelText(Text, a),
    Text({ dimColor: !working && !leaving, children: [stateText(a, now)] }),
    Text({ dimColor: true, children: [a.kind === 'pane' ? '' : tokens(a.input + a.output).padStart(7)] }),
  ]
  if (a.reason && a.reason !== 'table') kids.push(Text({ color: hex(MODEL_COLOR.fable), children: ['↑ ' + a.reason] }))
  return Box({ flexDirection: 'row', columnGap: 1, children: kids })
}

function header(els, tally) {
  const { Text } = els
  const parts = ['agentille', 'run ' + lastRun, tally.working + ' working', tally.done + ' done', tokens(tally.tok) + ' tok']
  const formation = runs.get(lastRun)?.formation
  if (formation) parts.splice(2, 0, formation)
  if (squads.length) parts.push('squads: ' + squads.map((q) => q.name).join('+'))
  parts.push('/agt-deck')
  return Text({ dimColor: true, children: [parts.join(' · ')] })
}

function card(els, a, i, now) {
  const { Box, Text, Raster } = els
  const working = a.state === 'working'
  const leaving = a.bye > 0
  // Frames 2 and 3 are the farewell wave, alternating while it plays.
  const frame = leaving ? 2 + (a.bye % 2) : working ? (tick + i) % 2 : 0
  return Box({
    flexDirection: 'column',
    width: 20,
    children: [
      Raster({ key: 'sprite-' + i, columns: 16, rows: 8, cells: cells(hatOf(a), a.model ?? 'other', frame) }),
      Text({ wrap: 'truncate', children: [(leaving ? '✓ ' : working ? '● ' : a.kind === 'pane' ? '▣ ' : '✓ ') + a.role] }),
      modelText(Text, a),
      Text({ dimColor: true, wrap: 'truncate', children: [stateText(a, now).replace(/\s+/g, ' ')] }),
      Text({ dimColor: true, children: [a.kind === 'pane' ? ' ' : tokens(a.input + a.output) + ' tok'] }),
    ],
  })
}

export function register(on) {
  on('session.start', async ($, e, next) => {
    await loadProfile($)
    await loadSquads($)
    transport = await detectTransport($)
    deckOpen = (await $.ui.panes()).some((p) => p.id === DECK)
    deckAuto = (await $.store.get('deck:auto')) !== false
    await $.command.register({ name: 'agt-routing', description: 'Show the model + effort agentille picked for each agent this session', immediate: true })
    await $.command.register({ name: 'agt-deck', description: 'Open the agentille deck now (it also opens on its own with /agt)', immediate: true })
    await $.command.register({ name: 'agt-nodeck', description: 'Stop the agentille deck from opening on its own; /agt-deck turns it back on', immediate: true })
    await $.command.register({ name: 'agt-spawn', description: 'Open a routed claude pane beside this one (Herdr or tmux); it is never reaped', argumentHint: '"task" [--model sonnet|opus|haiku|fable]' })
    await $.command.register({ name: 'agt-ledger', description: 'Tokens per agent role for the latest agentille run', immediate: true })
    focusMode = (await $.store.get('focus:mode')) ?? DEFAULT_FOCUS
    highlightOn = (await $.store.get('highlight:on')) !== false
    await $.command.register({ name: 'agt-highlight', description: 'Highlight /agt replies: an essentials card, paths, versions and numbers lit. on · off', argumentHint: '[on|off]', immediate: true })
    await $.command.register({ name: 'agt-focus', description: 'What needs you: agent flags and a short brief of long answers. all · agt · off', argumentHint: '[all|agt|off]', immediate: true })
    if (transport !== 'none') {
      // One look now: a lead restarted mid-run still reaps its leftover panes.
      await pollNow($, transport)
      if (panes.length) ensurePolling($)
      // The lead opens and closes its workers through the mod; a worker pane gets no fan-out of its own.
      if (!selfName) {
        await $.tool.register(SPAWN_TOOL)
        await $.tool.register(CLOSE_TOOL)
        paneTools = true
      }
    }
    if (busy()) ensureTicker($)
    return next(e)
  })

  on('command.run', { command: 'agt-routing' }, async () => {
    if (decisions.length === 0) return { text: 'No agentille dispatches this session.' }
    return { text: decisions.slice(-30).map((d) => d.role + ' → ' + d.model + ' · ' + d.effort + (d.reason === 'table' ? '' : '  (' + d.reason + ')') + (d.kind === 'pane' ? ' · pane' : '')).join('\n') }
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

  // /agt panes mode: the same openPane as /agt-spawn, with the input validated here.
  on('tool.call', { tool: 'mcp__agentille__spawn_pane' }, async ($, e) => {
    if (selfName) return { deny: 'This is a worker pane (' + selfName + '); workers do not open panes.' }
    const t = await transportOf($)
    if (t === 'none') return { deny: 'No pane transport here: run the slice as a subagent.' }
    const a = spawnToolInput(e, panes)
    if (a.error) return { deny: a.error }
    const cwd = a.cwd ?? (await $.session.cwd())
    if (a.cwd) {
      const s = await $.fs.stat(cwd).catch(() => null)
      if (s?.kind !== 'dir') return { deny: cwd + ' is not a directory.' }
    }
    agtTurn = true
    lastRun = a.run
    const run = runState(a.run)
    run.formation = formationOf(a.hdr) ?? run.formation
    // Counted only once the pane opens: a failed split is not a fix attempt.
    const fixes = run.fixes + (a.agent === 'executor' && a.hdr.mode === 'fix' ? 1 : 0)
    run.fable = Math.max(run.fable, Number((await $.store.get('fable:' + a.run)) ?? 0))
    const d = decide({ role: a.agent, hdr: a.hdr, run: { ...run, fixes }, depth, settings, weeklyPct })
    const r = paneRole(a.agent, d)
    if (!r.pane) return { deny: r.why }
    await pollNow($, t)
    opened = opened.filter((o) => panes.some((p) => p.id === o.id))
    const lead = t === 'tmux' ? await $.env.get('TMUX_PANE') : await $.env.get('HERDR_PANE_ID')
    const probe = async (id) => widthOf((await $.process.run(tmuxWidthArgv(id), PROBE).catch(() => null))?.stdout)
    const leadWidth = t === 'tmux' ? await probe(lead) : null
    const newestWidth = t === 'tmux' && opened.length ? await probe(opened[opened.length - 1].id) : null
    const plan = splitPlan({ lead, leadWidth, newestWidth, opened, live: panes })
    let id
    try {
      id = await openPane($, t, { run: a.run, name: a.name, model: d.model, effort: d.effort, task: a.task, cwd, split: { target: plan.target, direction: plan.direction } })
    } catch (err) {
      return { deny: 'Could not open a ' + t + ' pane: ' + String(err?.message ?? err).slice(0, 160) }
    }
    run.fixes = fixes
    if (d.fable) {
      run.fable += 1
      await $.store.set('fable:' + a.run, run.fable)
    }
    opened.push({ id, name: a.name, axis: plan.axis })
    paneRoutes.push({ name: a.name, run: a.run, role: a.role, agent: a.agent, model: d.model, effort: d.effort, reason: d.reason, start: Date.now(), end: null })
    const rec = { at: new Date().toISOString(), role: a.agent, model: d.model, effort: d.effort, reason: d.reason, asked: a.asked, agentId: null, kind: 'pane', pane: a.name }
    decisions.push(rec)
    run.log.push(JSON.stringify(rec))
    await writeRunFile($, a.run, 'routing.jsonl', run.log.join('\n') + '\n')
    await pollNow($, t)
    ensurePolling($)
    ensureTicker($)
    deckWaiting = null
    closeAfterBye = null
    await autoDeck($)
    if (d.reason !== 'table') $.ui.toast('agt ↑ ' + a.agent + ' → ' + d.model + ' · ' + d.effort + ' — ' + d.reason)
    return { result: 'Opened ' + a.name + ' · ' + d.model + ' · ' + d.effort + ' · ' + t + ' pane.' + (d.reason === 'table' ? '' : ' (' + d.reason + ')') }
  })

  on('tool.call', { tool: 'mcp__agentille__close_pane' }, async ($, e) => {
    if (selfName) return { deny: 'This is a worker pane (' + selfName + '); workers do not close panes.' }
    const t = await transportOf($)
    if (t === 'none') return { deny: 'No pane transport here.' }
    await pollNow($, t)
    const c = closeTarget(e, panes, t === 'herdr' ? selfTab : null)
    if (c.error) return { deny: c.error }
    const r = await $.process.run(t === 'herdr' ? herdrCloseArgv(c.pane.id) : tmuxKillArgv(c.pane.id), PROBE).catch(() => null)
    if (!r || r.exitCode !== 0) return { deny: 'Could not close ' + c.pane.name + '.' }
    await pollNow($, t)
    return { result: 'Closed ' + c.pane.name + '.' }
  })

  on('command.run', { command: 'agt-focus' }, async ($, e) => {
    const a = parseFocusArgs(e.args)
    if (a.error) return { text: a.error }
    if (a.mode) {
      focusMode = a.mode
      await $.store.set('focus:mode', a.mode)
      if (a.mode === 'off') brief = []
      $.ui.invalidate('ui.render')
    }
    return { text: focusText(focusMode, brief, focusLines(Date.now()).filter((l) => l.kind === 'flag' && !brief.includes(l)).map((l) => l.text)) }
  })

  on('command.run', { command: 'agt-highlight' }, async ($, e) => {
    const a = parseHighlightArgs(e.args)
    if (a.error) return { text: a.error }
    if (a.on !== undefined) {
      highlightOn = a.on
      await $.store.set('highlight:on', a.on)
      $.ui.invalidate('ui.render')
    }
    return { text: highlightText(highlightOn) }
  })

  on('command.run', { command: 'agt-ledger' }, async () => ({ text: ledgerText(ledger(live, lastRun, paneRoutes)) }))

  on('command.run', { command: 'agt-deck' }, async ($) => {
    deckOpen = true
    deckBy = 'person'
    deckDismissedRun = null
    await $.ui.open({ id: DECK, title: 'agentille deck', focus: true, closeOnEscape: true })
    if (deckAuto) return {}
    deckAuto = true
    await $.store.set('deck:auto', true)
    return { text: 'Deck auto-open is back on.' }
  })

  on('command.run', { command: 'agt-nodeck' }, async ($) => {
    deckAuto = false
    await $.store.set('deck:auto', false)
    if (deckOpen) await $.ui.close({ id: DECK })
    deckOpen = false
    return { text: 'Deck auto-open is off (kept across sessions). /agt-deck opens it and turns it back on.' }
  })

  on('ui.close', async ($, e, next) => {
    if (e.id === DECK) {
      deckOpen = false
      deckBy = null
      // Closed by hand: stay closed until the next typed /agt or a new run.
      if (e.origin.kind === 'person') {
        deckDismissedRun = lastRun
        deckWaiting = null
      }
    }
    return next(e)
  })

  // A typed /agt opens the deck as a waiting strip (the only open Claude Code seats at any
  // width); the first agent fills it, a turn with none closes it.
  on('prompt.submit', async ($, e, next) => {
    closeAfterBye = null
    // A task notification, plugin or peer turn is not the person's prompt: the run's state stays.
    const k = e.origin?.kind
    if (k !== undefined && k !== 'composer' && k !== 'bridge') return next(e)
    brief = []
    agtTurn = isAgtPrompt(e.text)
    if (agtTurn) {
      pendingForce = teamForce(e.text)
      if (pendingForce) $.ui.toast(teamNotice(await transportOf($)))
      deckDismissedRun = null
      flags = []   // a new run starts with a clean slate
      deckWaiting = { at: Date.now() }
      await autoDeck($)   // asked: seats at any width, as a waiting strip until an agent comes
    } else {
      pendingForce = null   // a force belongs to the /agt it was typed with
      // Answering the run's question: this prompt is asked too, so the strip comes back.
      if (reopenOnReply({ waiting: deckWaiting, now: Date.now() })) await autoDeck($)
      else deckWaiting = null
    }
    return next(e)
  })

  on('skill.prompt', async ($, e, next) => {
    if (!/(^|:)agt$/.test(e.skill)) return next(e)
    agtTurn = true
    const t = await transportOf($)
    if (t !== 'none') ensurePolling($)
    const forced = pendingForce ? teamDirective(t) : ''
    pendingForce = null
    return next({ ...e, text: e.text + squadBlock + transportBlock(t, paneTools && !selfName) + forced })
  })

  on('session.measure', async ($, e, next) => {
    const week = e.rateLimits.find((r) => r.kind === 'seven_day')
    if (week) weeklyPct = week.percentUsed
    return next(e)
  })

  on('agent.spawn', async ($, e, next) => {
    if (e.fork) return next(e)
    const role = roleOf(e.subagentType)

    if (!role) {
      const res = await next(e)
      if (res.agentId) live.set(res.agentId, newAgent({ id: res.agentId, role: shortType(e.subagentType), routed: false, model: res.model, effort: null, reason: null, run: lastRun, now: Date.now() }))
      ensureTicker($)
      if (agtTurn) deckWaiting = null
      closeAfterBye = null
      $.ui.invalidate('ui.render')
      return res
    }

    const hdr = parseHeader(e.prompt) ?? {}
    const runId = SAFE_RUN.test(hdr.run ?? '') ? hdr.run : 'adhoc'
    agtTurn = true
    lastRun = runId
    const run = runState(runId)
    run.formation = formationOf(hdr) ?? run.formation
    if (role === 'executor' && hdr.mode === 'fix') run.fixes += 1
    const shared = Number((await $.store.get('fable:' + runId)) ?? 0)
    run.fable = Math.max(run.fable, shared)

    const d = decide({ role, hdr, run, depth, settings, weeklyPct })
    const res = await next({ ...e, model: d.model })
    if (res.deny) return res

    if (d.fable) {
      run.fable += 1
      await $.store.set('fable:' + runId, run.fable)
    }
    if (res.agentId) live.set(res.agentId, newAgent({ id: res.agentId, role, routed: true, model: res.model, effort: d.effort, reason: d.reason, run: runId, now: Date.now() }))
    const rec = { at: new Date().toISOString(), role, model: res.model, effort: d.effort, reason: d.reason, asked: e.model ?? null, agentId: res.agentId ?? null }
    decisions.push(rec)
    run.log.push(JSON.stringify(rec))
    await writeRunFile($, runId, 'routing.jsonl', run.log.join('\n') + '\n')
    ensureTicker($)
    deckWaiting = null
    closeAfterBye = null
    await autoDeck($)
    if (d.reason !== 'table') $.ui.toast('agt ↑ ' + role + ' → ' + short(res.model) + ' · ' + d.effort + ' — ' + d.reason)
    $.ui.invalidate('ui.render')
    return res
  })

  on('turn.step', async function* ($, e, next) {
    const a = e.agentId ? live.get(e.agentId) : undefined
    const result = yield* next(a && a.routed ? { ...e, effort: a.effort } : e)
    if (a) {
      if (!a.effort && e.effort) a.effort = String(e.effort)
      addUsage(a, result?.usage)
      $.ui.invalidate('ui.render')
    }
    return result
  })

  on('turn.complete', async ($, e, next) => {
    const a = e.agentId ? live.get(e.agentId) : undefined
    if (!e.agentId) await endOfTurn($, endsOnQuestion(e.answer))
    if (!e.agentId && e.reason === 'answer' && shouldBrief({ answer: e.answer, mode: focusMode, agtTurn })) {
      // Off the turn's path: the answer shows now, the brief lands a moment later.
      const seq = ++briefSeq
      const answer = e.answer
      $.clock.after(0, async () => {
        const r = await $.model.complete({ model: 'haiku', system: BRIEF_SYSTEM, prompt: briefPrompt(answer), maxTokens: 300, effort: 'low', timeoutMs: 30_000 }).catch(() => null)
        if (seq !== briefSeq || !r?.isAnswered) return
        brief = parseBrief(r.text)
        $.ui.invalidate('ui.render')
      })
    }
    if (a) {
      if (a.routed) addFlag($, flagOf(a.role, e.answer))
      if (a.role === 'plan-reviewer' && verdictOf(e.answer) === 'REVISE') runState(a.run).revise += 1
      if (a.input + a.output === 0) addUsage(a, e.usage)
      finish(a, Date.now(), e.durationMs)
      await writeRunFile($, a.run, 'ledger.json', JSON.stringify(ledger(live, a.run, paneRoutes), null, 2) + '\n')
      ensureTicker($)
      $.ui.invalidate('ui.render')
    }
    return next(e)
  })

  // The band above the prompt: one row per agent of the latest run, plus herdr panes.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const now = Date.now()
    const { rows, tally } = stage({ agents: live, panes, routes: paneRoutes, tracker, run: lastRun })
    const focus = focusLines(now)
    if (rows.length === 0 && !selfName && focus.length === 0) return next(e)
    const els = $.ui.resolve(e)
    const max = Math.max(2, Math.min(8, (e.props.maxRows ?? 8) - 2 - focus.length))
    const kids = focus.map((l) => focusRow(els, l))
    if (selfName) kids.push(els.Text({ color: hex(MODEL_COLOR.opus), children: ['agentille worker · ' + selfName] }))
    if (rows.length) {
      kids.push(header(els, tally))
      for (const a of rows.slice(0, max)) kids.push(row(els, a, now))
      if (rows.length > max) kids.push(els.Text({ dimColor: true, children: ['+' + (rows.length - max) + ' more · /agt-deck'] }))
    }
    const theirs = await next(e)
    return els.Box({ flexDirection: 'column', children: [...kids, theirs] })
  })

  // A long /agt reply: an essentials card on top, the body dim with its tokens lit. The
  // decision is memoised per message id so a reply does not restyle when a later turn changes.
  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    if (!litFor(litMemo, e.requestId, { on: highlightOn, agtTurn })) return next(e)
    const h = highlight(e.props?.text)
    if (!h) return next(e)
    const els = $.ui.resolve(e)
    const body = h.body !== null ? els.Markdown({ text: h.body, dimColor: true }) : await next(e)
    return els.Box({ flexDirection: 'column', children: h.card.length ? [cardBox(els, h.card), body] : [body] })
  })

  // Main-session spinner: how many agents are working behind it.
  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    const n = [...live.values()].filter((a) => a.state === 'working').length + panes.filter((p) => p.state === 'working').length
    if (n === 0) return next(e)
    return next({ ...e, props: { ...e.props, suffix: ' · ' + n + ' agent' + (n > 1 ? 's' : '') + ' working…' } })
  })

  // The deck: a mini-Claude per agent, hat = role, hat color = model.
  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    if (e.requestId !== DECK) return next(e)
    const now = Date.now()
    const els = $.ui.resolve(e)
    const { rows, tally } = stage({ agents: live, panes, routes: paneRoutes, tracker, run: lastRun })
    if (rows.length === 0) return els.Text({ dimColor: true, children: [stripText({ run: lastRun, tally, waiting: !!deckWaiting })] })
    if (e.surface !== 'terminal') return els.Box({ flexDirection: 'column', children: [header(els, tally), ...rows.map((a) => row(els, a, now))] })
    const perRow = Math.max(1, Math.floor((e.props.bodyColumns ?? 80) / 21))
    const lines = []
    for (let i = 0; i < Math.min(rows.length, 24); i += perRow) {
      lines.push(els.Box({ flexDirection: 'row', columnGap: 1, children: rows.slice(i, i + perRow).map((a, j) => card(els, a, i + j, now)) }))
    }
    return els.Box({ flexDirection: 'column', rowGap: 1, children: [header(els, tally), ...lines] })
  })
}
