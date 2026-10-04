// agentille mod — routing, the live band, squads, the pane reaper (herdr and tmux), the worker
// mascot and focus. Policy and state live in routing.js / live.js / squads.js / mascot.js /
// focus.js; this file observes events, applies decisions, and draws.

import { DEFAULTS, decide, formationOf, parseHeader, roleOf, verdictOf } from './routing.js'
import { addUsage, effortBar, elapsed, endRoute, finish, isAgtPrompt, ledger, ledgerText, newAgent, paneAgents, panesLeft, reapable, short, stage, tokens, waving } from './live.js'
import { activeSquads, allPaths, depsOf, injection } from './squads.js'
import { BYE_MS, HELLO_MS, MASCOT_COLOR, MODEL_COLOR, agentMood, bandMascots, caption, frame, modelKey, moodAt, parseWorker } from './mascot.js'
import { MARK, SPAN_COLOR, highlight, highlightText, litFor, parseHighlightArgs, spans } from './highlight.js'
import { flagOf, focusText, paneFlags, parseFocusArgs } from './focus.js'
import {
  CLOSE_TOOL, HERDR_START_TIMEOUT, PROBE, SPAWN_TOOL, closeTarget, spawnToolInput, SAFE_RUN, SPAWN_ROLE, TMUX_LIST_ARGV, doneFile, herdrCloseArgv, herdrPaneIdOf, herdrPromptArgv, herdrSplitArgv, herdrStartArgv,
  isFreshDone, isLead, newRunId, paneName, paneRole, parseSpawnArgs, parseTmuxList, pickTransport, quietSpawn, reapPool, scopeRows, splitName, splitPlan, tmuxEvenArgv, tmuxKillArgv, tmuxPaneAgents, tmuxPaneIdOf,
  tmuxSplitArgv, tmuxTagArgvs, transportBlock,
} from './panes.js'

const hex = (n) => '#' + n.toString(16).padStart(6, '0')

let settings = { ...DEFAULTS }
let depth = null
let home = null
let weeklyPct = null
let lastRun = 'adhoc'
const runs = new Map()       // run id → { revise, fixes, fable, formation, log: [], reports: { role → count } }
const live = new Map()       // agentId → live agent (live.js)
const decisions = []         // this session, for /agt-routing
let panes = []               // agt-* panes (herdr or tmux) other than this one
const paneRoutes = []        // PaneRoute[], append-only: how each worker this lead opened was routed
let opened = []              // { id, name } of panes this lead opened via spawn_pane, in spawn order
const staged = new Map()     // pane name → last pane seen on stage (live.js panesLeft)
const paneSeen = new Map()   // reaper bookkeeping
const tmuxFirstSeen = new Map() // tmux pane id → when this session first listed it
let selfName = null          // this pane's name when it is an agt-* worker
let worker = null            // { agent, model, effort } from AGENTILLE_WORKER: this session is a worker pane
let selfTab = null           // herdr: the lead's own tab, where its workers split
let paneTools = false        // spawn_pane / close_pane registered for this lead
let squads = []              // active squads for this repo
let squadBlock = ''
let transport = null        // 'herdr' | 'tmux' | 'none', probed once at session start
let tick = 0
let pollTimer = null         // pane polling: runs only while panes may exist
let quietPolls = 0
let tickTimer = null         // redraw ticker: runs only while something works
let focusOn = true           // agent flags show above the prompt
let flags = []               // [{ text, at }] from agent results this run
let agtTurn = false          // this turn is part of an /agt run
let leadTurn = false         // a main-loop turn is running: its idle panes are waiting for review
const mascot = { greeted: false, hiUntil: 0, byeUntil: 0, working: false, start: 0, ms: null } // worker band, in $.clock.now() ms
let highlightOn = true       // /agt replies get an essentials card and lit tokens
let highlightAll = false     // …and so does every other long reply (/agt-highlight all)
const litMemo = new Map()    // message id → was it an /agt turn when first drawn
const FLAG_TTL_MS = 30 * 60_000
const FOCUS_COLOR = { next: '#3fb950', flag: '#f85149' }

function runState(id) {
  if (!runs.has(id)) runs.set(id, { revise: 0, fixes: 0, fable: 0, formation: null, log: [], reports: {} })
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

async function writeRunFile($, runId, name, text) {
  if (!home || !SAFE_RUN.test(runId) || runId === 'adhoc') return
  try {
    await $.fs.write(home + '/.agentille/state/run-' + runId + '/' + name, text)
  } catch {
    // the run dir is the orchestrator's; logging never blocks a dispatch
  }
}

// Panes that left the stage this poll: end their route and refresh the ledger.
async function notePaneExits($) {
  const touched = new Set()
  for (const name of panesLeft(staged, panes)) {
    const r = endRoute(paneRoutes, name, Date.now())
    if (r) touched.add(r.run)
  }
  for (const run of touched) await writeRunFile($, run, 'ledger.json', JSON.stringify(ledger(live, run, paneRoutes), null, 2) + '\n')
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
  await notePaneExits($)
  if (me && !selfName) {
    const mine = panes.filter((p) => p.tab === me.tab_id)
    for (const p of reapable(reapPool(mine), paneSeen, await $.clock.now(), leadTurn)) {
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
  const id = herdrPaneIdOf((await runOk($, herdrSplitArgv({ pane, cwd: o.cwd, run: o.run, direction: o.split?.direction, agent: o.agent, model: o.model, effort: o.effort }), PROBE)).stdout)
  if (!id) throw new Error('herdr gave no pane id')
  try {
    await runOk($, herdrStartArgv({ name: o.name, pane: id, model: o.model, effort: o.effort, agent: o.agent }), HERDR_START_TIMEOUT)
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
  await notePaneExits($)
  if (isLead(rows, selfPane)) {
    for (const p of reapable(reapPool(panes), paneSeen, now, leadTurn)) {
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

// A subagent's raw answer goes to run-<id>/agents/<role>-<n>.md, written here so the lead spends
// no tokens copying it. n counts per role in the run; a second turn of the same agent overwrites.
async function writeReport($, a, answer) {
  if (!a.routed || !answer) return
  const counts = runState(a.run).reports
  a.report ??= a.role + '-' + (counts[a.role] = (counts[a.role] ?? 0) + 1) + '.md'
  await writeRunFile($, a.run, 'agents/' + a.report, answer)
}

const working = () => [...live.values()].some((a) => a.state === 'working') || panes.some((p) => p.state === 'working')

// Pane polling starts when panes can exist (an /agt run, a spawn, panes found at start) and
// stops after a minute with no agt- pane and nothing working.
function ensurePolling($) {
  if (pollTimer || !transport || transport === 'none') return
  quietPolls = 0
  pollTimer = $.clock.every(5000, () => {
    pollNow($, transport).then(() => {
      if (panes.length || working()) { quietPolls = 0; ensureTicker($); return }
      if (++quietPolls >= 12) { pollTimer?.cancel(); pollTimer = null }
    })
  })
}

// Redraw while something works, a worker's mascot is animating or a finished subagent is
// still waving (elapsed times tick, legs step); the ticker cancels itself once all are idle.
const animating = (now) => (!!worker && moodAt({ ...mascot, now }) !== 'idle') || [...live.values()].some((a) => waving(a, Date.now()))

function ensureTicker($) {
  if (tickTimer) return
  tickTimer = $.clock.every(600, async () => {
    if (!working() && !animating(await $.clock.now())) {
      tickTimer?.cancel()
      tickTimer = null
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
  if (!focusOn) return []
  const fresh = flags.filter((f) => now - f.at < FLAG_TTL_MS).map((f) => f.text)
  return [...fresh, ...paneFlags(panes)].slice(0, 5)
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

const focusRow = (els, text) => els.Text({ color: FOCUS_COLOR.flag, wrap: 'truncate', children: ['⚑ ' + text] })

// ── drawing helpers (take resolved elements, never $) ─────────────────────────

function modelText(Text, a) {
  if (a.kind === 'pane' && !a.model) return Text({ color: hex(MODEL_COLOR.other), children: [(a.vendor + ' pane').padEnd(15)] })
  const m = short(a.model)
  const label = (m === 'other' ? shortType(a.model).slice(0, 6) : m) + ' ' + effortBar(a.effort) + ' ' + (a.effort ?? '')
  return Text({ color: hex(MODEL_COLOR[modelKey(a.model)]), children: [label.padEnd(15)] })
}

function stateText(a, now) {
  if (a.kind === 'pane') return a.state === 'working' && a.start ? ('working ' + elapsed(now - a.start).padStart(5)) : a.state.padEnd(13)
  const t = elapsed((a.end ?? now) - a.start)
  return (a.state === 'working' ? 'working ' : 'done    ') + t.padStart(5)
}

function row(els, a, now) {
  const { Box, Text } = els
  const working = a.state === 'working'
  const glyph = a.kind === 'pane' ? '▣' : working ? '●' : '✓'
  const color = hex(MODEL_COLOR[modelKey(a.model)])
  const kids = [
    Text({ color, children: [glyph] }),
    Text({ dimColor: !working, children: [a.role.slice(0, 18).padEnd(18)] }),
    modelText(Text, a),
    Text({ dimColor: !working, children: [stateText(a, now)] }),
    Text({ dimColor: true, children: [a.kind === 'pane' ? '' : tokens(a.input + a.output).padStart(7)] }),
  ]
  if (a.reason && a.reason !== 'table') kids.push(Text({ color: hex(MODEL_COLOR.fable), children: ['↑ ' + a.reason] }))
  return Box({ flexDirection: 'row', columnGap: 1, children: kids })
}

// A subagent's row in the lead's band with its mascot: three rows, the text row beside the body.
const GREETING = { hi: '  hi!', bye: '  bye!' }
function mascotRow(els, a, now) {
  const { Box, Text } = els
  const mood = agentMood(a, now)
  const [head, body, legs] = frame(mood, tick, a.role)
  const orange = hex(MASCOT_COLOR)
  return [
    Text({ color: orange, children: [head + (GREETING[mood] ?? '')] }),
    Box({ flexDirection: 'row', children: [Text({ color: orange, children: [body.padEnd(13)] }), row(els, a, now)] }),
    Text({ color: orange, children: [legs] }),
  ]
}

function header(els, tally) {
  const { Text } = els
  const parts = ['agentille', 'run ' + lastRun, tally.working + ' working', tally.done + ' done', tokens(tally.tok) + ' tok']
  const formation = runs.get(lastRun)?.formation
  if (formation) parts.splice(2, 0, formation)
  if (squads.length) parts.push('squads: ' + squads.map((q) => q.name).join('+'))
  return Text({ dimColor: true, children: [parts.join(' · ')] })
}

// A worker's own band: the mascot's three rows over a caption, or the caption alone when the
// band is short, off a terminal, or nothing is animating.
function workerBand(els, e, now) {
  const { Box, Text } = els
  const mood = moodAt({ ...mascot, now })
  const cap = caption({ mood, ...worker, ms: mood === 'working' ? now - mascot.start : mascot.ms })
  const capText = Text({ color: hex(MODEL_COLOR[modelKey(worker.model)]), wrap: 'truncate', children: [cap] })
  if (mood === 'idle' || e.surface !== 'terminal' || (e.props.maxRows ?? 0) < 5) return [capText]
  const [head, body, legs] = frame(mood, tick, worker.agent)
  const orange = hex(MASCOT_COLOR)
  return [Text({ color: orange, children: [head] }), Text({ color: orange, children: [body] }), Box({ flexDirection: 'row', children: [Text({ color: orange, children: [legs + '   '] }), capText] })]
}

export function register(on) {
  on('session.start', async ($, e, next) => {
    await loadProfile($)
    await loadSquads($)
    transport = await detectTransport($)
    worker = parseWorker(await $.env.get('AGENTILLE_WORKER'))
    await $.command.register({ name: 'agt-routing', description: 'Show the model + effort agentille picked for each agent this session', immediate: true })
    await $.command.register({ name: 'agt-spawn', description: 'Open a routed claude pane beside this one (Herdr or tmux); it is never reaped', argumentHint: '"task" [--model sonnet|opus|haiku|fable]' })
    await $.command.register({ name: 'agt-ledger', description: 'Tokens per agent role for the latest agentille run', immediate: true })
    focusOn = (await $.store.get('focus:mode')) !== 'off'
    highlightOn = (await $.store.get('highlight:on')) !== false
    highlightAll = (await $.store.get('highlight:all')) === true
    await $.command.register({ name: 'agt-highlight', description: 'Highlight replies: an essentials card, paths, versions and numbers lit. on (/agt only) · all · off', argumentHint: '[on|all|off]', immediate: true })
    await $.command.register({ name: 'agt-focus', description: 'Show agent flags above the prompt (a REVISE, a FAIL, a blocked pane). on · off', argumentHint: '[on|off]', immediate: true })
    if (transport !== 'none') {
      // One look now: a lead restarted mid-run still reaps its leftover panes.
      await pollNow($, transport)
      if (panes.length) ensurePolling($)
      // The lead opens and closes its workers through the mod; a worker pane gets no fan-out of its own.
      if (!selfName && !worker) {
        await $.tool.register(SPAWN_TOOL)
        await $.tool.register(CLOSE_TOOL)
        paneTools = true
      }
    }
    if (working()) ensureTicker($)
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
    if (selfName || worker) return { deny: 'This is a worker pane (' + (selfName ?? worker.agent) + '); workers do not open panes.' }
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
    const r = paneRole(a.agent)
    if (!r.pane) return { deny: r.why }
    await pollNow($, t)
    opened = opened.filter((o) => panes.some((p) => p.id === o.id))
    const lead = t === 'tmux' ? await $.env.get('TMUX_PANE') : await $.env.get('HERDR_PANE_ID')
    const plan = splitPlan({ lead, opened, live: panes })
    let id
    try {
      id = await openPane($, t, { run: a.run, name: a.name, agent: a.agent, model: d.model, effort: d.effort, task: a.task, cwd, split: { target: plan.target, direction: plan.direction } })
    } catch (err) {
      return { deny: 'Could not open a ' + t + ' pane: ' + String(err?.message ?? err).slice(0, 160) }
    }
    run.fixes = fixes
    if (d.fable) {
      run.fable += 1
      await $.store.set('fable:' + a.run, run.fable)
    }
    opened.push({ id, name: a.name })
    paneRoutes.push({ name: a.name, run: a.run, role: a.role, agent: a.agent, model: d.model, effort: d.effort, reason: d.reason, start: Date.now(), end: null })
    const rec = { at: new Date().toISOString(), role: a.agent, model: d.model, effort: d.effort, reason: d.reason, asked: a.asked, agentId: null, kind: 'pane', pane: a.name }
    decisions.push(rec)
    run.log.push(JSON.stringify(rec))
    await writeRunFile($, a.run, 'routing.jsonl', run.log.join('\n') + '\n')
    await pollNow($, t)
    ensurePolling($)
    ensureTicker($)
    if (d.reason !== 'table') $.ui.toast('agt ↑ ' + a.agent + ' → ' + d.model + ' · ' + d.effort + ' — ' + d.reason)
    return { result: 'Opened ' + a.name + ' · ' + d.model + ' · ' + d.effort + ' · ' + t + ' pane.' + (d.reason === 'table' ? '' : ' (' + d.reason + ')') }
  })

  on('tool.call', { tool: 'mcp__agentille__close_pane' }, async ($, e) => {
    if (selfName || worker) return { deny: 'This is a worker pane (' + (selfName ?? worker.agent) + '); workers do not close panes.' }
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
    if (a.on !== undefined) {
      focusOn = a.on
      await $.store.set('focus:mode', a.on ? 'on' : 'off')
      $.ui.invalidate('ui.render')
    }
    return { text: focusText(focusOn, focusLines(Date.now())) }
  })

  on('command.run', { command: 'agt-highlight' }, async ($, e) => {
    const a = parseHighlightArgs(e.args)
    if (a.error) return { text: a.error }
    if (a.on !== undefined) {
      highlightOn = a.on
      highlightAll = a.all
      await $.store.set('highlight:on', a.on)
      await $.store.set('highlight:all', a.all)
      $.ui.invalidate('ui.render')
    }
    return { text: highlightText(highlightOn, highlightAll) }
  })

  on('command.run', { command: 'agt-ledger' }, async () => ({ text: ledgerText(ledger(live, lastRun, paneRoutes)) }))

  // A typed /agt starts a clean run; a task notification, plugin or peer turn is not the person's prompt.
  on('prompt.submit', async ($, e, next) => {
    const k = e.origin?.kind
    if (k !== undefined && k !== 'composer' && k !== 'bridge') return next(e)
    agtTurn = isAgtPrompt(e.text)
    if (agtTurn) flags = []   // a new run starts with a clean slate
    return next(e)
  })

  on('skill.prompt', async ($, e, next) => {
    if (!/(^|:)agt$/.test(e.skill)) return next(e)
    agtTurn = true
    const t = await transportOf($)
    if (t !== 'none') ensurePolling($)
    return next({ ...e, text: e.text + squadBlock + transportBlock(t, paneTools && !selfName) })
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

  // A main-loop turn began (a subagent's run raises none). A worker's first one plays hello.
  on('turn.start', async ($, e, next) => {
    leadTurn = true
    if (worker) {
      const now = await $.clock.now()
      if (!mascot.greeted) {
        mascot.greeted = true
        mascot.hiUntil = now + HELLO_MS
        // tmux tags the pane name after the split, so the first poll can miss it: look once more.
        if (!selfName && transport && transport !== 'none') await pollNow($, transport)
      }
      mascot.working = true
      mascot.start = now
      ensureTicker($)
      $.ui.invalidate('ui.render')
    }
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const a = e.agentId ? live.get(e.agentId) : undefined
    if (!e.agentId) leadTurn = false
    if (!e.agentId && worker && mascot.working) {
      const now = await $.clock.now()
      mascot.working = false
      mascot.ms = now - mascot.start
      if (e.reason === 'answer') mascot.byeUntil = now + BYE_MS
      ensureTicker($)
      $.ui.invalidate('ui.render')
    }
    if (a) {
      if (a.routed) addFlag($, flagOf(a.role, e.answer))
      if (a.role === 'plan-reviewer' && verdictOf(e.answer) === 'REVISE') runState(a.run).revise += 1
      if (a.input + a.output === 0) addUsage(a, e.usage)
      finish(a, Date.now(), e.durationMs)
      await writeReport($, a, e.answer)
      await writeRunFile($, a.run, 'ledger.json', JSON.stringify(ledger(live, a.run, paneRoutes), null, 2) + '\n')
      ensureTicker($)
      $.ui.invalidate('ui.render')
    }
    return next(e)
  })

  // The band above the prompt: one row per agent of the latest run, plus herdr panes.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const now = Date.now()
    const { rows, tally } = stage({ agents: live, panes, routes: paneRoutes, run: lastRun, now })
    const focus = focusLines(now)
    if (rows.length === 0 && !selfName && !worker && focus.length === 0) return next(e)
    const els = $.ui.resolve(e)
    const max = Math.max(2, Math.min(8, (e.props.maxRows ?? 8) - 2 - focus.length))
    const kids = focus.map((l) => focusRow(els, l))
    if (worker) kids.push(...workerBand(els, e, await $.clock.now()))
    else if (selfName) kids.push(els.Text({ color: hex(MODEL_COLOR.opus), children: ['agentille worker · ' + selfName] }))
    if (rows.length) {
      kids.push(header(els, tally))
      const room = (e.props.maxRows ?? 8) - 2 - focus.length - (worker || selfName ? 1 : 0)
      if (e.surface === 'terminal' && bandMascots(rows, room)) {
        for (const a of rows) kids.push(...(a.kind === 'sub' ? mascotRow(els, a, now) : [row(els, a, now)]))
      } else {
        for (const a of rows.slice(0, max)) kids.push(row(els, a, now))
        if (rows.length > max) kids.push(els.Text({ dimColor: true, children: ['+' + (rows.length - max) + ' more'] }))
      }
    }
    const theirs = await next(e)
    return els.Box({ flexDirection: 'column', children: [...kids, theirs] })
  })

  // A long /agt reply: an essentials card on top, the body dim with its tokens lit. The
  // decision is memoised per message id so a reply does not restyle when a later turn changes.
  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    if (!litFor(litMemo, e.requestId, { on: highlightOn, agtTurn: agtTurn || highlightAll })) return next(e)
    const h = highlight(e.props?.text)
    if (!h) return next(e)
    const els = $.ui.resolve(e)
    if (!els.Markdown) return next(e)
    const body = h.body !== null ? els.Markdown({ text: h.body, dimColor: true }) : await next(e)
    return els.Box({ flexDirection: 'column', children: h.card.length ? [cardBox(els, h.card), body] : [body] })
  })

  // Main-session spinner: how many agents are working behind it.
  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    const n = [...live.values()].filter((a) => a.state === 'working').length + panes.filter((p) => p.state === 'working').length
    if (n === 0) return next(e)
    return next({ ...e, props: { ...e.props, suffix: ' · ' + n + ' agent' + (n > 1 ? 's' : '') + ' working…' } })
  })
}
