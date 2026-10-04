// agentille routing policy — pure functions, no mods API.
// register.js feeds it what the mod observed; it returns { model, effort, reason }.
// The table and ladder mirror skills/agt/model-routing.md (that doc is the spec).

const ROLE_PREFIX = 'agentille:agentille-'

// [model, effort] per role: default · size=large · risk auth/money · thinkingDepth=quick
const TABLE = {
  planner:             { base: ['opus', 'high'],     large: ['opus', 'xhigh'], risk: null,              quick: ['sonnet', 'medium'] },
  'plan-reviewer':     { base: ['sonnet', 'medium'], large: ['opus', 'high'],  risk: null,              quick: ['sonnet', 'medium'] },
  'ui-prototyper':     { base: ['opus', 'high'],     large: ['opus', 'high'],  risk: null,              quick: ['sonnet', 'medium'] },
  executor:            { base: ['sonnet', 'medium'], large: ['sonnet', 'high'], risk: ['sonnet', 'high'], quick: ['sonnet', 'medium'] },
  'code-reviewer':     { base: ['sonnet', 'medium'], large: ['opus', 'high'],  risk: ['opus', 'high'],   quick: ['sonnet', 'medium'] },
  'design-reviewer':   { base: ['opus', 'high'],     large: ['opus', 'high'],  risk: ['opus', 'high'],   quick: ['opus', 'high'] },
  'security-reviewer': { base: ['opus', 'high'],     large: ['opus', 'high'],  risk: ['opus', 'max'],    quick: ['sonnet', 'high'] },
  'payments-reviewer': { base: ['opus', 'high'],     large: ['opus', 'high'],  risk: ['opus', 'max'],    quick: ['sonnet', 'high'] },
  'seo-reviewer':      { base: ['sonnet', 'medium'], large: ['sonnet', 'high'], risk: null,              quick: ['sonnet', 'low'] },
  'perf-reviewer':     { base: ['sonnet', 'high'],   large: ['opus', 'high'],  risk: null,              quick: ['sonnet', 'medium'] },
  adversary:           { base: ['sonnet', 'high'],   large: ['sonnet', 'high'], risk: ['opus', 'high'],   quick: ['sonnet', 'medium'] },
}

export const ROLES = Object.keys(TABLE)

// Roles that may run on Fable. The executor never changes model.
const FABLE_ROLES = new Set(['planner', 'ui-prototyper', 'design-reviewer', 'security-reviewer', 'payments-reviewer', 'code-reviewer', 'plan-reviewer'])
const FORCED_FABLE_NEEDS_LARGE = new Set(['code-reviewer', 'plan-reviewer'])

// Run shapes beyond the plain roster (skills/agt/formations.md); shown in the band header.
export const FORMATIONS = new Set(['duel', 'gauntlet', 'relay'])

export function formationOf(hdr) {
  return hdr && FORMATIONS.has(hdr.formation) ? hdr.formation : null
}

export const DEFAULTS = { autoFable: true, maxFablePerRun: 1, fableWeeklyCeiling: 60 }

export function roleOf(subagentType) {
  if (typeof subagentType !== 'string' || !subagentType.startsWith(ROLE_PREFIX)) return null
  const role = subagentType.slice(ROLE_PREFIX.length)
  return TABLE[role] ? role : null
}

// "[agt run=a1b2 size=large risk=auth mode=fix fable=auto]" on the prompt's first line
export function parseHeader(prompt) {
  const first = String(prompt ?? '').split('\n', 1)[0]
  const m = /^\s*\[agt\s+([^\]]*)\]/.exec(first)
  if (!m) return null
  const h = {}
  for (const pair of m[1].trim().split(/\s+/)) {
    const i = pair.indexOf('=')
    if (i > 0) h[pair.slice(0, i)] = pair.slice(i + 1)
  }
  return h
}

// First verdict word in a plan-reviewer answer, or null.
export function verdictOf(answer) {
  const m = /\b(APPROVE|REVISE)\b/.exec(String(answer ?? ''))
  return m ? m[1] : null
}

function base(role, hdr, depth) {
  const row = TABLE[role]
  if (depth === 'quick') return row.quick
  if ((hdr.risk === 'auth' || hdr.risk === 'money') && row.risk) return row.risk
  if (hdr.size === 'large') return row.large
  return row.base
}

// run: { revise, fixes, fable } observed so far · settings: profile.routing merged over DEFAULTS
// weeklyPct: seven_day percent used, or null when unknown
export function decide({ role, hdr = {}, run = { revise: 0, fixes: 0, fable: 0 }, depth, settings = DEFAULTS, weeklyPct = null }) {
  let [model, effort] = base(role, hdr, depth)
  const reasons = []

  if (hdr.fable === 'forced' && FABLE_ROLES.has(role) && (!FORCED_FABLE_NEEDS_LARGE.has(role) || model === 'opus')) {
    return { model: 'fable', effort: 'high', reason: '--fable typed', fable: true }
  }

  // Ladder rung 1–2: effort first, on observed failure.
  if (role === 'planner' && run.revise === 1) { effort = 'max'; reasons.push('plan REVISE ×1') }
  if (role === 'executor' && hdr.mode === 'fix') {
    const attempt = run.fixes // this dispatch already counted
    if (attempt === 2) { effort = 'high'; reasons.push('fix attempt 2') }
    if (attempt >= 3) { effort = 'max'; reasons.push('fix attempt ' + attempt) }
  }

  // Ladder rung 3: Fable, only after two observed failures at Opus max.
  const candidate =
    (role === 'planner' && run.revise >= 2 && hdr.mode !== 'diagnose') ? 'plan REVISE ×2' :
    (role === 'planner' && hdr.mode === 'diagnose' && run.fixes >= 3) ? run.fixes + ' failed fixes' :
    null
  if (!candidate) return { model, effort, reason: reasons.join(', ') || 'table', fable: false }

  const block =
    settings.autoFable === false ? 'autoFable off' :
    run.fable >= settings.maxFablePerRun ? 'Fable cap ' + settings.maxFablePerRun + '/run reached' :
    (weeklyPct != null && weeklyPct >= settings.fableWeeklyCeiling) ? 'weekly ' + weeklyPct + '% ≥ ' + settings.fableWeeklyCeiling + '%' :
    null
  if (block) return { model: 'opus', effort: 'max', reason: candidate + ' · Fable blocked: ' + block, fable: false }
  return { model: 'fable', effort: 'high', reason: candidate, fable: true }
}
