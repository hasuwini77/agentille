// agentille mod — routing, the switchboard band, the wire between sessions, the /agt-deck pane,
// squads, the pane reaper (herdr and tmux), the worker mascot and focus. Policy and state live in
// routing.js / live.js / board.js / wire.js / squads.js / mascot.js / focus.js; this file
// observes events, applies decisions, and draws.

import { DEFAULTS, decide, formationOf, parseHeader, roleOf, verdictOf } from './routing.js'
import { addUsage, elapsed, endRoute, finish, isAgtPrompt, ledger, ledgerText, newAgent, paneAgents, panesLeft, reapable, short, stage, waving } from './live.js'
import { ACCENT, FRAME_COLOR, WIRE_COLOR, boardRows, cast, castColumns, chip, colorOf, header, leadLine, routingLines, tokenBars, toolLabel, wireLines, wireRow } from './board.js'
import { PUBLISH_MS, doneMessage, freshStatus, logWire, parseTellArgs, parseWire, shortName, statusKey, validLead, wireEnv, workerStatus } from './wire.js'
import { activeSquads, allPaths, depsOf, injection } from './squads.js'
import { BYE_MS, HELLO_MS, MASCOT_COLOR, MODEL_COLOR, agentMood, caption, frame, modelKey, moodAt, parseWorker } from './mascot.js'
import { MARK, SPAN_COLOR, highlight, highlightText, litFor, parseHighlightArgs, spans } from './highlight.js'
import { flagOf, focusText, paneFlags, parseFocusArgs } from './focus.js'
import {
  CLOSE_TOOL, HERDR_START_TIMEOUT, PROBE, SPAWN_TOOL, closeTarget, focusArgv, herdrMetaArgv, spawnToolInput, SAFE_RUN, SPAWN_ROLE, TMUX_LIST_ARGV, doneFile, herdrCloseArgv, herdrPaneIdOf, herdrPromptArgv, herdrSplitArgv, herdrStartArgv,
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
let sessionId = null         // this session's id: workers it opens send their results here
let leadModel = null         // the main loop's model, for the tree's root
const wireLog = []           // [{ from, to, kind, summary, at }] messages between sessions, newest last
const wireStatus = new Map() // pane name → what its worker last published (wire.js workerStatus)
let wireName = null          // worker: its own agt- name (AGENTILLE_NAME), where it publishes
let leadSession = null       // worker: the lead's session id (AGENTILLE_LEAD), where it reports
const pub = { state: 'starting', tool: null, tok: 0, model: null, effort: null, start: null, at: 0 } // worker's published status
let lastMeta = ''            // worker: the last Herdr sidebar title it reported
let deckAuto = false         // /agt-deck auto: the deck opens on every typed /agt
const DECK = 'agt-deck'
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
    const id = tmuxPaneIdOf((await runOk($, tmuxSplitArgv({ ...o, target, shell, direction: o.split?.direction, env: wireEnv({ name: o.name, lead: sessionId }) }), PROBE)).stdout)
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
  const id = herdrPaneIdOf((await runOk($, herdrSplitArgv({ pane, cwd: o.cwd, run: o.run, direction: o.split?.direction, agent: o.agent, model: o.model, effort: o.effort, env: wireEnv({ name: o.name, lead: sessionId }) }), PROBE)).stdout)
  if (!id) throw new Error('herdr gave no pane id')
  try {
    await runOk($, herdrStartArgv({ name: o.name, pane: id, model: o.model, effort: o.effort, agent: o.agent }), HERDR_START_TIMEOUT)
    await runOk($, herdrPromptArgv(o.name, o.task), PROBE)
  } catch (err) {
    await $.process.run(herdrCloseArgv(id), PROBE).catch(() => {})
    throw err
  }
  // Herdr's sidebar names the worker by role and route; cosmetic, so a failure is ignored.
  const meta = herdrMetaArgv(id, { display: '▣ ' + shortName(o.name) + ' · ' + o.model })
  if (meta) await $.process.run(meta, PROBE).catch(() => {})
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
  tickTimer = $.clock.every(300, async () => {
    if (!working() && !animating(await $.clock.now())) {
      tickTimer?.cancel()
      tickTimer = null
    } else tick += 1
    if (panes.length && tick % 3 === 0) await readWire($)
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

// ── the wire (worker side publishes and reports; lead side reads) ─────────────

// Worker: what it is doing, into the shared store, at most once per PUBLISH_MS unless forced.
async function publish($, force = false) {
  if (!wireName) return
  const now = Date.now()
  if (!force && now - pub.at < PUBLISH_MS) return
  pub.at = now
  await $.store.set(statusKey(wireName), workerStatus({ name: wireName, session: sessionId, ...pub, now })).catch(() => {})
  if (transport !== 'herdr') return
  // Herdr's sidebar follows the worker: its route, then what it is doing. Changes only.
  const title = pub.state === 'done' ? '✓ done ' + elapsed(pub.ms ?? 0) : pub.tool ?? pub.state
  if (title === lastMeta) return
  lastMeta = title
  const pane = await $.env.get('HERDR_PANE_ID')
  const argv = pane && herdrMetaArgv(pane, { display: '▣ ' + shortName(wireName) + ' · ' + (worker?.model ?? short(pub.model)), title })
  if (argv) await $.process.run(argv, PROBE).catch(() => {})
}

// Worker: a finished turn saves the full answer under the run and messages the lead its head,
// so the lead wakes on its own and never scrapes the pane.
async function reportDone($, answer) {
  const n = splitName(wireName)
  let reportPath = null
  if (n && answer && home) {
    await writeRunFile($, n.run, 'agents/pane-' + n.role + '.md', answer)
    reportPath = home + '/.agentille/state/run-' + n.run + '/agents/pane-' + n.role + '.md'
  }
  if (!leadSession) return
  const text = doneMessage({ name: wireName, ms: pub.ms ?? 0, model: worker?.model ?? short(pub.model), effort: worker?.effort || pub.effort, tok: pub.tok, answer, reportPath })
  const r = await $.session.send({ to: { sessionId: leadSession }, text }).catch((err) => ({ isDelivered: false, reason: String(err?.message ?? err) }))
  if (r.isDelivered) logWire(wireLog, { from: shortName(wireName), to: 'lead', kind: 'done', summary: 'reported to the lead', at: Date.now() })
  else $.ui.toast('agt wire: the lead did not get the result (' + String(r.reason).slice(0, 80) + ')')
}

// Lead: what each visible worker last published.
async function readWire($) {
  const now = Date.now()
  for (const p of panes) {
    const rec = await $.store.get(statusKey(p.name)).catch(() => null)
    if (freshStatus(rec, p.name, now)) wireStatus.set(p.name, rec)
  }
  for (const k of [...wireStatus.keys()]) if (!panes.some((p) => p.name === k)) wireStatus.delete(k)
}

// ── drawing (takes resolved elements, never $) ────────────────────────────────

const INK = '#14161c'

function boardHeader(els, h) {
  const { Box, Text } = els
  return Box({
    flexDirection: 'row',
    justifyContent: 'space-between',
    children: [
      Text({ wrap: 'truncate', children: [Text({ color: hex(ACCENT), children: ['◆ agentille'] }), Text({ dimColor: true, children: ['  ' + h.left] })] }),
      Text({ dimColor: true, children: [h.right] }),
    ],
  })
}

function leadRow(els, l) {
  const { Text } = els
  return Text({ wrap: 'truncate', children: [Text({ color: l.color, children: ['◉ '] }), l.text, Text({ dimColor: true, children: ['  ' + l.state] })] })
}

// One agent: tree · kind glyph · role · transport · model pill · effort · spinner + what it does ·
// elapsed · tokens, and a ↗ that jumps to a pane worker.
function boardRow(els, r, onFocus) {
  const { Box, Text, Button } = els
  const kids = [Text({ dimColor: true, children: [r.tree] }), Text({ color: r.glyphColor, children: [r.glyph] }), Text({ dimColor: r.dim, children: [r.role] })]
  if (r.kind) kids.push(Text({ dimColor: true, children: [r.kind] }))
  kids.push(r.dim ? Text({ color: r.chipColor, dimColor: true, children: [r.chip] }) : Text({ color: INK, backgroundColor: r.chipColor, children: [r.chip] }))
  kids.push(Text({ color: colorOf('fable'), children: [r.escalated ? '↑' : ' '] }))
  if (r.effort) kids.push(Text({ dimColor: true, children: [r.effort] }))
  kids.push(Box({ flexGrow: 1, flexShrink: 1, children: [Text({ wrap: 'truncate', dimColor: r.dim, children: [Text({ color: r.glyphColor, children: [r.spinner + ' '] }), r.activity] })] }))
  kids.push(Text({ dimColor: true, children: [r.time] }))
  if (r.tok) kids.push(Text({ dimColor: true, children: [r.tok] }))
  if (onFocus) kids.push(Button({ label: '↗', plain: true, dimColor: true, onPress: onFocus }))
  return Box({ flexDirection: 'row', columnGap: 1, children: kids })
}

function wireLine(els, w) {
  const { Text } = els
  return Text({ wrap: 'truncate', children: [Text({ color: hex(WIRE_COLOR), children: ['⇄ ' + w.arrow + '  '] }), w.text, Text({ dimColor: true, children: ['  ' + w.ago] })] })
}

const rule = (els, label) => els.Text({ dimColor: true, children: ['── ' + label + ' ' + '─'.repeat(Math.max(0, 40 - label.length))] })

// A worker's own band: the mascot's three rows over a caption, or the caption alone when the
// band is short, off a terminal, or nothing is animating.
function workerBand(els, e, now) {
  const { Box, Text } = els
  const mood = moodAt({ ...mascot, now })
  const cap = caption({ mood, ...worker, ms: mood === 'working' ? now - mascot.start : mascot.ms })
  const capText = Text({ color: hex(MODEL_COLOR[modelKey(worker.model)]), wrap: 'truncate', children: [cap] })
  if (mood === 'idle' || e.surface !== 'terminal' || (e.props.maxRows ?? 0) < 5) return [capText]
  const [head, body, legs] = frame(mood, tick >> 1, worker.agent)
  const orange = hex(MASCOT_COLOR)
  return [Text({ color: orange, children: [head] }), Text({ color: orange, children: [body] }), Box({ flexDirection: 'row', children: [Text({ color: orange, children: [legs + '   '] }), capText] })]
}

export function register(on) {
  on('session.start', async ($, e, next) => {
    await loadProfile($)
    await loadSquads($)
    transport = await detectTransport($)
    worker = parseWorker(await $.env.get('AGENTILLE_WORKER'))
    sessionId = validLead(await $.session.id().catch(() => null))
    wireName = /^agt-[A-Za-z0-9_-]+$/.test((await $.env.get('AGENTILLE_NAME')) ?? '') ? await $.env.get('AGENTILLE_NAME') : null
    leadSession = wireName ? validLead(await $.env.get('AGENTILLE_LEAD')) : null
    if (worker) { pub.model = worker.model; pub.effort = worker.effort || null }
    deckAuto = (await $.store.get('deck:auto')) === true
    await $.command.register({ name: 'agt-deck', description: 'Open the agentille deck: the cast, routing timeline, wire log and tokens. auto = open on every /agt · off', argumentHint: '[auto|off]', immediate: true })
    await $.command.register({ name: 'agt-tell', description: 'Send a message to a worker pane over the wire', argumentHint: '<worker> <message>', immediate: true })
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
    if (wireName) await publish($, true)
    return next(e)
  })

  on('command.run', { command: 'agt-deck' }, async ($, e) => {
    const a = String(e.args ?? '').trim().toLowerCase()
    if (a && a !== 'auto' && a !== 'off') return { text: 'Usage: /agt-deck [auto|off]' }
    if (a) {
      deckAuto = a === 'auto'
      await $.store.set('deck:auto', deckAuto)
      if (!deckAuto) return { text: 'deck: opens only when you type /agt-deck' }
    }
    await $.ui.open({ id: DECK, title: 'agentille' })
    return { text: 'deck open' + (deckAuto ? ' · opens on every /agt (/agt-deck off to stop)' : '') }
  })

  // Typed only. The worker gets it as a peer message over the wire; a Herdr worker without the
  // mod still gets it as a prompt.
  on('command.run', { command: 'agt-tell' }, async ($, e) => {
    if (!['composer', 'bridge'].includes(e.origin?.kind)) return { text: '/agt-tell runs only when typed.' }
    const t = await transportOf($)
    if (t !== 'none') await pollNow($, t)
    const a = parseTellArgs(e.args, panes)
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
    if (agtTurn && deckAuto) void $.ui.open({ id: DECK, title: 'agentille' })
    return next(e)
  })

  on('skill.prompt', async ($, e, next) => {
    if (!/(^|:)agt$/.test(e.skill)) return next(e)
    agtTurn = true
    const t = await transportOf($)
    if (t !== 'none') ensurePolling($)
    return next({ ...e, text: e.text + squadBlock + transportBlock(t, paneTools && !selfName) })
  })

  // Worker results arrive as peer messages: log them for the band and the deck, then let the
  // model read them (that delivery is what wakes the lead).
  on('session.receive', async ($, e, next) => {
    const w = parseWire(e.text)
    if (w) {
      const from = shortName(w.from)
      logWire(wireLog, { from, to: wireName ? shortName(wireName) : 'lead', kind: w.kind, summary: w.summary, at: Date.now() })
      $.ui.toast('⇄ ' + from + ' ' + w.kind)
      $.ui.invalidate('ui.render')
    }
    return next(e)
  })

  // What each agent is doing right now, for its band row: a subagent's call carries its agentId;
  // a worker pane's own main loop publishes for its lead. Observe only.
  on('tool.call', async ($, e, next) => {
    if (e.agentId) {
      const a = live.get(e.agentId)
      if (a) a.tool = toolLabel(e.tool, e)
    } else if (wireName) {
      pub.tool = toolLabel(e.tool, e)
      await publish($)
    }
    return next(e)
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
    if (!e.agentId) leadModel = e.model
    const result = yield* next(a && a.routed ? { ...e, effort: a.effort } : e)
    if (!e.agentId && wireName && result?.usage) {
      const u = result.usage
      pub.tok += (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.output_tokens ?? 0)
      pub.model = e.model
      await publish($)
    }
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
    if (wireName) {
      Object.assign(pub, { state: 'working', tool: null, start: Date.now(), ms: null })
      await publish($, true)
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
    if (!e.agentId && wireName && pub.state === 'working') {
      Object.assign(pub, { state: 'done', tool: null, ms: Date.now() - (pub.start ?? Date.now()) })
      await publish($, true)
      if (e.reason === 'answer') await reportDone($, e.answer)
    }
    if (a) {
      a.tool = null
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

  // The switchboard above the prompt: a framed dispatch tree rooted at the lead, one row per
  // subagent (◇) and pane session (▣), the newest wire message, and any agent flags.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const now = Date.now()
    const staged = stage({ agents: live, panes, routes: paneRoutes, run: lastRun, now })
    const focus = focusLines(now)
    const wire = wireRow(wireLog, now)
    if (staged.rows.length === 0 && !selfName && !worker && focus.length === 0 && !wire) return next(e)
    const els = $.ui.resolve(e)
    const kids = focus.map((l) => focusRow(els, l))
    if (worker) kids.push(...workerBand(els, e, await $.clock.now()))
    else if (selfName) kids.push(els.Text({ color: hex(MODEL_COLOR.opus), children: ['agentille worker · ' + selfName] }))
    const theirs = await next(e)
    if (staged.rows.length === 0 && !wire) return els.Box({ flexDirection: 'column', children: [...kids, theirs] })

    const rows = cast(staged, live, lastRun)
    const cols = (e.props.bodyColumns ?? 80) - 4
    const view = boardRows(rows, { now, tick, cols, wire: wireStatus, transport })
    const room = Math.max(1, (e.props.maxRows ?? 10) - 4 - kids.length - (wire ? 1 : 0))
    const waiting = rows.filter((r) => r.state === 'working').length
    const inner = [boardHeader(els, header({ run: lastRun, formation: runs.get(lastRun)?.formation, squads: squads.map((q) => q.name), rows, tally: staged.tally }))]
    if (rows.length) inner.push(leadRow(els, leadLine({ model: leadModel, busy: e.props.isWorking, waiting })))
    for (const r of view.slice(0, room)) {
      const argv = r.pane ? focusArgv(transport, rows.find((x) => x.id === r.id)) : null
      inner.push(boardRow(els, r, argv ? () => { $.process.run(argv, PROBE).catch(() => {}) } : null))
    }
    if (view.length > room) inner.push(els.Text({ dimColor: true, children: ['   +' + (view.length - room) + ' more · /agt-deck'] }))
    if (wire) inner.push(wireLine(els, wire))
    const board = els.Box({ flexDirection: 'column', borderStyle: 'round', borderColor: hex(FRAME_COLOR), paddingX: 1, children: inner })
    return els.Box({ flexDirection: 'column', children: [...kids, board, theirs] })
  })

  // The deck: the whole run at a glance, drawn only while the person keeps it open.
  on('ui.render', { component: 'Pane', requestId: DECK }, async ($, e) => {
    const els = $.ui.resolve(e)
    const { Box, Text } = els
    const now = Date.now()
    const staged = stage({ agents: live, panes, routes: paneRoutes, run: lastRun, now })
    const rows = cast({ rows: [...staged.rows, ...[...live.values()].filter((a) => a.run === lastRun && !staged.rows.includes(a))], tally: { working: 0 } }, live, lastRun)
    const cols = e.props.bodyColumns ?? 80
    const kids = [boardHeader(els, header({ run: lastRun, formation: runs.get(lastRun)?.formation, squads: squads.map((q) => q.name), rows, tally: staged.tally }))]
    if (rows.length === 0 && decisions.length === 0 && wireLog.length === 0) {
      kids.push(Text({ dimColor: true, children: ['No agents yet. Type /agt "task": every dispatch shows up here.'] }))
      return Box({ flexDirection: 'column', children: kids })
    }
    if (rows.length) {
      kids.push(rule(els, 'cast'))
      const c = castColumns(rows, { cols, tick: tick >> 1, frameOf: frame, moodOf: (r) => (r.kind === 'sub' ? agentMood(r, now) : r.state === 'working' ? 'working' : 'bye') })
      const orange = hex(MASCOT_COLOR)
      const line = (pick) => Box({ flexDirection: 'row', children: c.cells.map(pick) })
      for (const i of [0, 1, 2]) kids.push(line((m) => Text({ color: orange, dimColor: m.dim, children: [m.lines[i]] })))
      kids.push(line((m) => Text({ dimColor: m.dim, children: [(m.glyph + ' ' + m.role).padEnd(14)] })))
      kids.push(line((m) => Box({ width: 14, children: [m.model ? Text({ color: INK, backgroundColor: colorOf(m.model), children: [chip(m.model)] }) : Text({ dimColor: true, children: ['pane'] })] })))
      if (c.more > 0) kids.push(Text({ dimColor: true, children: ['+' + c.more + ' more'] }))
    }
    if (decisions.length) {
      kids.push(rule(els, 'routing'))
      for (const d of routingLines(decisions)) kids.push(Text({ wrap: 'truncate', children: [Text({ dimColor: true, children: [d.at + '  '] }), d.who + '  ', Text({ color: d.color, children: [d.route] }), Text({ color: d.escalated ? colorOf('fable') : undefined, dimColor: !d.escalated, children: [d.reason] })] }))
    }
    if (wireLog.length) {
      kids.push(rule(els, 'wire'))
      for (const w of wireLines(wireLog)) kids.push(Text({ wrap: 'truncate', children: [Text({ dimColor: true, children: [w.at + '  '] }), Text({ color: hex(WIRE_COLOR), children: [w.arrow + ' '] }), Text({ dimColor: true, children: [w.kind + ' '] }), w.text] }))
    }
    const bars = tokenBars(ledger(live, lastRun, paneRoutes), Math.max(8, Math.min(30, cols - 30)))
    if (bars.length) {
      kids.push(rule(els, 'tokens'))
      for (const b of bars) kids.push(Text({ children: [b.name + ' ', Text({ color: hex(ACCENT), children: [b.bar] }), Text({ dimColor: true, children: [' ' + b.tok] })] }))
    }
    return Box({ flexDirection: 'column', children: kids })
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

  // Main-session spinner: how many subagents (◇) and pane sessions (▣) work behind it.
  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    const subs = [...live.values()].filter((a) => a.state === 'working').length
    const sessions = panes.filter((p) => p.state === 'working').length
    if (subs + sessions === 0) return next(e)
    const parts = [subs ? '◇' + subs : '', sessions ? '▣' + sessions : ''].filter(Boolean).join(' ')
    return next({ ...e, props: { ...e.props, suffix: ' · ' + parts + ' working' } })
  })
}
