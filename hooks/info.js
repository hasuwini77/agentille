// agentille info — the pure half of /agt-info: argument parsing, the overview lines, and the route
// dry-run. No mods API; register.js feeds it what the mod holds.

import { ROLES, decide } from './routing.js'
import { elapsed, short, tokens } from './live.js'
import { displayText } from './settings.js'

export const INFO_USAGE = 'Usage: /agt-info [routing|ledger|squads|route <role> [size=small|large] [risk=none|auth|money|data] [depth=quick|complex-only|always]]'

const SIZES = ['small', 'large']
const RISKS = ['none', 'auth', 'money', 'data']
const DEPTHS = ['quick', 'complex-only', 'always']

// "agentille:agentille-planner", "agentille-planner" and "planner" all name the planner.
function roleName(word) {
  return String(word).replace(/^agentille:/, '').replace(/^agentille-/, '')
}

// → { view: 'overview' | 'routing' | 'ledger' | 'squads' } | { view: 'route', role, hdr, depth } | { error }
export function parseInfoArgs(args) {
  const words = String(args ?? '').trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return { view: 'overview' }
  const sub = words[0].toLowerCase()
  if (sub === 'routing' || sub === 'ledger' || sub === 'squads') {
    return words.length === 1 ? { view: sub } : { error: INFO_USAGE }
  }
  if (sub !== 'route') return { error: INFO_USAGE }
  if (words.length < 2) return { error: 'Usage: /agt-info route <role> [size=…] [risk=…] [depth=…]. Roles: ' + ROLES.join(', ') }
  const role = roleName(words[1])
  if (!ROLES.includes(role)) return { error: 'Unknown role "' + words[1] + '". Valid roles: ' + ROLES.join(', ') }
  const hdr = {}
  let depth = null
  for (const w of words.slice(2)) {
    const i = w.indexOf('=')
    const k = i > 0 ? w.slice(0, i).toLowerCase() : ''
    const v = i > 0 ? w.slice(i + 1).toLowerCase() : ''
    if (k === 'size' && SIZES.includes(v)) hdr.size = v
    else if (k === 'risk' && RISKS.includes(v)) hdr.risk = v
    else if (k === 'depth' && DEPTHS.includes(v)) depth = v
    else return { error: 'Cannot read "' + w + '". Use size=' + SIZES.join('|') + ', risk=' + RISKS.join('|') + ', depth=' + DEPTHS.join('|') }
  }
  return { view: 'route', role, hdr, depth }
}

const pick = (d) => d.model + (d.effort ? ' · ' + d.effort : '') + ' · ' + d.reason

// Dry-run of decide() with fresh run state under the person's routing settings, then each escalation
// rung that changes the pick. Nothing here touches a live run.
export function routeText({ role, hdr = {}, depth = null }, settings, weeklyPct = null) {
  const ask = (h, run) => decide({ role, hdr: h, run: { revise: 0, fixes: 0, fable: 0, ...run }, depth, settings, weeklyPct })
  const base = ask(hdr, {})
  const head = role + (hdr.size ? ' size=' + hdr.size : '') + (hdr.risk ? ' risk=' + hdr.risk : '') + (depth ? ' depth=' + depth : '')
  const rungs = [
    ['1st REVISE', ask(hdr, { revise: 1 })],
    ['2nd REVISE', ask(hdr, { revise: 2 })],
    ['fix attempt 2', ask({ ...hdr, mode: 'fix' }, { fixes: 2 })],
    ['fix attempt 3', ask({ ...hdr, mode: 'fix' }, { fixes: 3 })],
    ['diagnose, 2 failed fixes', ask({ ...hdr, mode: 'diagnose' }, { fixes: 2 })],
  ].filter(([, d]) => d.model !== base.model || d.effort !== base.effort || d.reason !== base.reason)
  const lines = [head + ' → ' + pick(base)]
  if (rungs.length === 0) lines.push('  no escalation rungs for this role')
  for (const [label, d] of rungs) lines.push('  ' + label.padEnd(26) + pick(d))
  return lines.join('\n')
}

// One line: how many dispatches the run logged and on which models.
export function routingSummary(logLines) {
  const models = new Map()
  let n = 0
  for (const l of logLines ?? []) {
    try {
      const r = JSON.parse(l)
      n += 1
      const m = short(r.model)
      models.set(m, (models.get(m) ?? 0) + 1)
    } catch { /* a bad log line is skipped */ }
  }
  if (n === 0) return 'routing: no dispatches yet (/agt-info routing)'
  return 'routing: ' + n + ' dispatch' + (n === 1 ? '' : 'es') + ' · ' + [...models].map(([m, c]) => m + ' ' + c).join(' · ') + ' (/agt-info routing)'
}

export function ledgerSummary(l) {
  if (!l || l.total.agents === 0) return 'ledger: no agents in this run yet (/agt-info ledger)'
  const t = l.total
  return 'ledger: run ' + l.run + ' · ' + t.agents + ' agent' + (t.agents === 1 ? '' : 's') + ' · in ' + tokens(t.input) + ' · out ' + tokens(t.output) + ' · ' + elapsed(t.ms) + ' (/agt-info ledger)'
}

export function squadsSummary(rows) {
  if (rows === null) return 'squads: squads.json is unreadable (/agt-info squads)'
  const active = rows.filter((r) => r.active).map((r) => r.name)
  return 'squads: ' + (active.length ? active.join(', ') : 'none active') + ' (/agt-info squads)'
}

export function overviewText({ display, squads, routing, ledger }) {
  return ['display (profile.json → display):', displayText(display), squads, routing, ledger, 'more: /agt-info routing | ledger | squads | route <role>'].join('\n')
}
