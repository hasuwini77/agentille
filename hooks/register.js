// agentille mod — routing, the live view, squads, and the herdr reaper.
// Policy and state live in routing.js / live.js / squads.js / sprites.js; this file
// observes events, applies decisions, and draws.

import { DEFAULTS, decide, parseHeader, roleOf, verdictOf } from './routing.js'
import { addUsage, effortBar, elapsed, finish, isAgtPrompt, ledger, ledgerText, newAgent, paneAgents, reapable, shouldAutoOpen, short, summary, tokens, visible } from './live.js'
import { activeSquads, allPaths, depsOf, injection } from './squads.js'
import { cells, MODEL_COLOR, modelKey } from './sprites.js'

const SAFE_RUN = /^[A-Za-z0-9_-]{1,64}$/
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
let panes = []               // herdr agt-* panes other than this one
const paneSeen = new Map()   // reaper bookkeeping
let selfName = null          // this pane's herdr name when it is an agt-* worker
let squads = []              // active squads for this repo
let squadBlock = ''
let deckOpen = false
let deckAuto = true          // open the deck on its own when a run starts
let deckDismissedRun = null  // run whose deck the person closed by hand
let tick = 0

function runState(id) {
  if (!runs.has(id)) runs.set(id, { revise: 0, fixes: 0, fable: 0, log: [] })
  return runs.get(id)
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
  // Show the workspace's agt-* panes; reap only the lead's own tab, where herdr mode
  // splits its workers. Workers (panes that are themselves agt-*) never reap.
  panes = paneAgents(list, selfPane).filter((p) => !me || p.workspace === me.workspace_id)
  if (me && !selfName) {
    const mine = panes.filter((p) => p.tab === me.tab_id)
    for (const p of reapable(mine, paneSeen, Date.now())) {
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

// ── drawing helpers (take resolved elements, never $) ─────────────────────────

function modelText(Text, a) {
  if (a.kind === 'pane') return Text({ color: hex(MODEL_COLOR.other), children: [(a.vendor + ' pane').padEnd(15)] })
  const m = short(a.model)
  const label = (m === 'other' ? shortType(a.model).slice(0, 6) : m) + ' ' + effortBar(a.effort) + ' ' + (a.effort ?? '')
  return Text({ color: hex(MODEL_COLOR[modelKey(a.model)]), children: [label.padEnd(15)] })
}

function stateText(a, now) {
  if (a.kind === 'pane') return a.state.padEnd(13)
  const t = elapsed((a.end ?? now) - a.start)
  return (a.state === 'working' ? 'working ' : 'done    ') + t.padStart(5)
}

function row(els, a, now) {
  const { Box, Text } = els
  const working = a.kind === 'pane' ? a.state === 'working' : a.state === 'working'
  const glyph = a.kind === 'pane' ? '▣' : working ? '●' : '✓'
  const color = a.kind === 'pane' ? hex(MODEL_COLOR.other) : hex(MODEL_COLOR[modelKey(a.model)])
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

function header(els, rows) {
  const { Text } = els
  const s = summary(rows)
  const parts = ['agentille', 'run ' + lastRun, s.working + ' working', s.done + ' done', tokens(s.tok) + ' tok']
  if (squads.length) parts.push('squads: ' + squads.map((q) => q.name).join('+'))
  parts.push('/agt-deck')
  return Text({ dimColor: true, children: [parts.join(' · ')] })
}

function card(els, a, i, now) {
  const { Box, Text, Raster } = els
  const working = a.state === 'working'
  const frame = working ? (tick + i) % 2 : 0
  const model = a.kind === 'pane' ? 'other' : a.model
  return Box({
    flexDirection: 'column',
    width: 20,
    children: [
      Raster({ key: 'sprite-' + i, columns: 16, rows: 8, cells: cells(a.role, model, frame) }),
      Text({ wrap: 'truncate', children: [(working ? '● ' : a.kind === 'pane' ? '▣ ' : '✓ ') + a.role] }),
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
    deckOpen = (await $.ui.panes()).some((p) => p.id === DECK)
    deckAuto = (await $.store.get('deck:auto')) !== false
    await $.command.register({ name: 'agt-routing', description: 'Show the model + effort agentille picked for each agent this session', immediate: true })
    await $.command.register({ name: 'agt-deck', description: 'Open the agentille deck now (it also opens on its own with /agt)', immediate: true })
    await $.command.register({ name: 'agt-nodeck', description: 'Stop the agentille deck from opening on its own; /agt-deck turns it back on', immediate: true })
    await $.command.register({ name: 'agt-ledger', description: 'Tokens per agent role for the latest agentille run', immediate: true })
    if ((await $.env.get('HERDR_ENV')) === '1') {
      await pollHerdr($)
      $.clock.every(5000, () => { pollHerdr($) })
    }
    // Redraw while something is working: elapsed times tick, deck sprites bob.
    $.clock.every(600, () => {
      const busy = [...live.values()].some((a) => a.state === 'working') || panes.some((p) => p.state === 'working')
      if (!busy) return
      tick ^= 1
      $.ui.invalidate('ui.render')
    })
    return next(e)
  })

  on('command.run', { command: 'agt-routing' }, async () => {
    if (decisions.length === 0) return { text: 'No agentille dispatches this session.' }
    return { text: decisions.slice(-30).map((d) => d.role + ' → ' + d.model + ' · ' + d.effort + (d.reason === 'table' ? '' : '  (' + d.reason + ')')).join('\n') }
  })

  on('command.run', { command: 'agt-ledger' }, async () => ({ text: ledgerText(ledger(live, lastRun)) }))

  on('command.run', { command: 'agt-deck' }, async ($) => {
    deckOpen = true
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
      // Closed by hand: stay closed until the next typed /agt or a new run.
      if (e.origin.kind === 'person') deckDismissedRun = lastRun
    }
    return next(e)
  })

  // A typed /agt opens the deck; answering the person's prompt, it seats at any width.
  on('prompt.submit', async ($, e, next) => {
    if (isAgtPrompt(e.text)) {
      deckDismissedRun = null
      await autoDeck($)
    }
    return next(e)
  })

  on('skill.prompt', async ($, e, next) => {
    if (!/(^|:)agt$/.test(e.skill)) return next(e)
    await autoDeck($)
    if (!squadBlock) return next(e)
    return next({ ...e, text: e.text + squadBlock })
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
      $.ui.invalidate('ui.render')
      return res
    }

    const hdr = parseHeader(e.prompt) ?? {}
    const runId = SAFE_RUN.test(hdr.run ?? '') ? hdr.run : 'adhoc'
    lastRun = runId
    const run = runState(runId)
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
    if (a) {
      if (a.role === 'plan-reviewer' && verdictOf(e.answer) === 'REVISE') runState(a.run).revise += 1
      if (a.input + a.output === 0) addUsage(a, e.usage)
      finish(a, Date.now(), e.durationMs)
      await writeRunFile($, a.run, 'ledger.json', JSON.stringify(ledger(live, a.run), null, 2) + '\n')
      $.ui.invalidate('ui.render')
    }
    return next(e)
  })

  // The band above the prompt: one row per agent of the latest run, plus herdr panes.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const now = Date.now()
    const rows = visible(live, panes, now)
    if (rows.length === 0 && !selfName) return next(e)
    const els = $.ui.resolve(e)
    const max = Math.max(2, Math.min(8, (e.props.maxRows ?? 8) - 2))
    const kids = []
    if (selfName) kids.push(els.Text({ color: hex(MODEL_COLOR.opus), children: ['agentille worker · ' + selfName] }))
    if (rows.length) {
      kids.push(header(els, rows))
      for (const a of rows.slice(0, max)) kids.push(row(els, a, now))
      if (rows.length > max) kids.push(els.Text({ dimColor: true, children: ['+' + (rows.length - max) + ' more · /agt-deck'] }))
    }
    const theirs = await next(e)
    return els.Box({ flexDirection: 'column', children: [...kids, theirs] })
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
    const rows = visible(live, panes, now)
    if (rows.length === 0) return els.Text({ dimColor: true, children: ['No agents yet. Run /agt and they show up here.'] })
    if (e.surface !== 'terminal') return els.Box({ flexDirection: 'column', children: [header(els, rows), ...rows.map((a) => row(els, a, now))] })
    const perRow = Math.max(1, Math.floor((e.props.bodyColumns ?? 80) / 21))
    const lines = []
    for (let i = 0; i < Math.min(rows.length, 24); i += perRow) {
      lines.push(els.Box({ flexDirection: 'row', columnGap: 1, children: rows.slice(i, i + perRow).map((a, j) => card(els, a, i + j, now)) }))
    }
    return els.Box({ flexDirection: 'column', rowGap: 1, children: [header(els, rows), ...lines] })
  })
}
