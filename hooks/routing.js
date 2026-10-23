// agentille routing policy — pure functions, no mods API.
// register.js feeds it what the mod observed; it returns { model, effort, reason }.
// The table and ladder mirror skills/agt/routing.md → "Default routing" (that doc is the spec).

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

// autoFable is opt-in: Fable costs about twice Opus, so the ladder may only reach it when profile.routing.autoFable is true.
export const DEFAULTS = { autoFable: false, maxFablePerRun: 1, fableWeeklyCeiling: 60, advisorOnOpus: true }

export function roleOf(subagentType) {
  if (typeof subagentType !== 'string' || !subagentType.startsWith(ROLE_PREFIX)) return null
  const role = subagentType.slice(ROLE_PREFIX.length)
  return Object.hasOwn(TABLE, role) ? role : null
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

// Proof that the person typed `--fable` on the /agt line. The dispatch header is written by the
// model, so `fable=forced` on its own proves nothing; the mod keeps what the typed prompt said.
export function typedFable(text) {
  return /(^|\s)--fable(?=\s|$)/.test(String(text ?? ''))
}

// A header's `fable=forced` holds only with that proof; without it the ladder applies (`fable=auto`)
// and the caller says so once. `demoted` is true when the header was rewritten.
export function proveHeader(hdr, { fableTyped = false } = {}) {
  if (!hdr || hdr.fable !== 'forced' || fableTyped) return { hdr, demoted: false }
  return { hdr: { ...hdr, fable: 'auto' }, demoted: true }
}

// The same rewrite on a prompt's first line, so a worker pane never inherits an unproven `fable=forced`.
export function demoteHeaderText(text) {
  const t = String(text ?? '')
  const nl = t.indexOf('\n')
  const first = nl < 0 ? t : t.slice(0, nl)
  if (!/^\s*\[agt\s[^\]]*\]/.test(first)) return t
  return first.replace(/\bfable=forced\b/, 'fable=auto') + (nl < 0 ? '' : t.slice(nl))
}

// A typed prompt that asks for sessions of the person's own ("open three sessions", "start 2 codex
// panes", "give me a shell"), or a typed /storm (its hand-off opens one): the only turns in which
// open_sessions may run. The noun must stand alone: "open the sessions file", "start the shell
// script" and "spawn the pane handler" name a thing to edit, not a pane to open.
const SESSION_NOUN = '(sessions?|panes?|terminals?|claudes?|codex(?:es)?|shells?)'
const NOT_A_PANE = '(?!\\s+(?:file|script|config|cookie|build|table|folder|handler|store|id|token|state|list)s?\\b|\\.\\w)'
const SESSION_ASK = new RegExp('\\b(open|start|spawn|launch|fire up|give me|get me|bring up)\\b[^.\\n]{0,40}?\\b' + SESSION_NOUN + '\\b' + NOT_A_PANE, 'i')
const STORM_TYPED = /^\s*\/(agentille:)?storm\b/
export function asksSessions(text) {
  const t = String(text ?? '')
  return STORM_TYPED.test(t) || SESSION_ASK.test(t)
}

// A plan-reviewer's verdict, or null. Its `VERDICT: APPROVE|REVISE` line (markdown emphasis tolerated)
// decides; only without one does the first stray verdict word, so "nothing to REVISE" cannot flip it.
export function verdictOf(answer) {
  const a = String(answer ?? '')
  const m = /^[^\w\n]*VERDICT[^\w\n]*(APPROVE|REVISE)\b/im.exec(a) ?? /\b(APPROVE|REVISE)\b/.exec(a)
  return m ? m[1].toUpperCase() : null
}

function base(role, hdr, depth) {
  const row = TABLE[role]
  if (depth === 'quick') return row.quick
  if ((hdr.risk === 'auth' || hdr.risk === 'money') && row.risk) return row.risk
  if (hdr.size === 'large') return row.large
  return row.base
}

// Fix rounds count per piece (factory.md: at most 2 fix rounds per piece), so two pieces in fix rounds never push each
// other up the ladder. `run.fixesByPiece` maps piece → rounds ('' = no piece). Without a piece (a diagnose planner, a
// single-piece run) the ladder sees the worst piece.
export function ladderFixes(run, piece) {
  const by = run?.fixesByPiece ?? {}
  if (piece) return by[piece] ?? 0
  const all = Object.values(by)
  return all.length ? Math.max(...all) : 0
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
  if (role === 'planner' && run.revise === 1) { model = 'opus'; effort = 'max'; reasons.push('plan REVISE ×1') }
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
    settings.autoFable !== true ? 'autoFable off' :
    run.fable >= settings.maxFablePerRun ? 'Fable cap ' + settings.maxFablePerRun + '/run reached' :
    (weeklyPct != null && weeklyPct >= settings.fableWeeklyCeiling) ? 'weekly ' + weeklyPct + '% ≥ ' + settings.fableWeeklyCeiling + '%' :
    null
  if (block) return { model: 'opus', effort: 'max', reason: candidate + ' · Fable blocked: ' + block, fable: false }
  return { model: 'fable', effort: 'high', reason: candidate, fable: true }
}
