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
  // `slice=<slug>` is the docs' name for `piece=`: both parse, and `piece=` wins when a header carries the two.
  if (h.slice !== undefined && h.piece === undefined) h.piece = h.slice
  return h
}

// Proof that the person typed `--fable` on the /agt line. The dispatch header is written by the
// model, so `fable=forced` on its own proves nothing; the mod keeps what the typed prompt said.
// The flag counts in the flag region right after `/agt` (with the level) or as the line's last word:
// "/agt heavy fix the --fable flag parser" names a flag inside the task and proves nothing.
const LEVELS = new Set(['low', 'medium', 'heavy', 'next'])
export function typedFable(text) {
  const first = String(text ?? '').split('\n', 1)[0].trim()
  const words = first.split(/\s+/)
  if (!/^\/(agentille:)?agt$/.test(words[0] ?? '')) return false
  if (words.length > 1 && words[words.length - 1] === '--fable') return true
  let value = false // the word after --mode or --formation is that flag's value
  for (const w of words.slice(1)) {
    if (w === '--fable') return true
    if (value) { value = false; continue }
    if (w === '--mode' || w === '--formation') value = true
    else if (!LEVELS.has(w) && !w.startsWith('--')) return false
  }
  return false
}

// `--fable` anywhere in a typed ask for sessions ("open a session with --fable and ship it"): the flag then rides
// into the session's first prompt. Not a proof for a dispatch header; typedFable above is.
export function mentionsFable(text) {
  return /(^|\s)--fable(?=\s|$)/.test(String(text ?? ''))
}

// A typed /agt is proof for its own run, not for the session. The run is in flight while one of this lead's worker
// panes still works (an /agt-spawn pane is the person's, not the run's), while a subagent of the run is working and
// was heard from lately (a cancelled one raises no turn.complete), or, until its ✓/✗ card clears the proof, for
// fewer than AGT_GRACE_TYPED typed prompts after the /agt: the person answering a question the run asked. Turns the
// run itself wakes (a worker's report, a task notification) do not count, so a fix round after a quiet gap still
// opens its pane. `st` is the mod's state record (S); `now` is Date.now(), the clock agents are heard by.
export const AGT_GRACE_TYPED = 3
export const AGENT_SILENT_MS = 10 * 60_000
export function runInFlight(st, now = Date.now()) {
  if (!st?.agtTyped) return false
  if ((st.panes ?? []).some((p) => p.role !== 'spawn' && !['done', 'idle', 'dead'].includes(p.state))) return true
  const run = st.lastRun
  if (run && run !== 'adhoc' && [...(st.live?.values() ?? [])].some((a) => a.run === run && a.state === 'working' && now - (a.heard ?? a.start ?? 0) < AGENT_SILENT_MS)) return true
  return (st.agtTypedSince ?? 0) < AGT_GRACE_TYPED
}

// The person named Codex in a typed prompt ("codex builds the API slice", "use Codex"): the only proof a worker pane
// may run on vendor codex. A word on its own: "/codex-reviewer" and "codex-cli" name something else.
export function mentionsCodex(text) {
  return /(?<![\w/-])codex(?:es)?(?![\w-])/i.test(String(text ?? ''))
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
// open_sessions may run. The ask starts the prompt or a sentence (after "please", "can you", "then" …),
// takes at most a count and a kind before the noun, and the noun must stand alone: "why does my app
// start two shells", "give me a summary of the sessions middleware", "open the sessions file" and
// "spawn the pane handler" talk about a thing, not a pane to open. What follows the noun decides: the end,
// punctuation, a linking word ("for", "in", "running", "here" …) or a count or kind ("sessions: 2 claude").
// A noun followed by another noun names a thing ("a terminal emulator project", "a shell injection test").
const SESSION_NOUN = '(sessions?|panes?|terminals?|claudes?|codex(?:es)?|shells?)'
const NOT_A_PANE = '(?!\\s+(?:file|script|config|cookie|build|table|folder|handler|store|id|token|state|list|middleware|module|log|project|emulator|summary|summaries|test|suite|injection|manager|timeout|storage|replay|hijack|hijacking|fixation|key|data|history|variable|output|command|app|library|lib|tab|layout|component|logic|bug|issue|leak|support|type|class|api|code|feature|ticket|recording)s?\\b|\\.\\w)'
const FOLLOW = '(?=\\s*$|\\s*[,!?;:)\\]`"“‘(]|\\.(?!\\w)|\\s+[-–—]\\s|\\s+(?:for|with|in|at|on|named|called|running|that|to|and|so|here|there|beside|next|below|under|alongside|inside|from|then|now|please|too|which|where|each|via|using)\\b|\\s+(?:\\d+|one|two|three|four|five|six|seven|eight|claude|codex|shell)\\b)'
const LEAD_IN = '(?:^|[.!?;:\\n]\\s*)(?:(?:please|pls|now|then|also|and|next|first|ok|okay)[,\\s]+)*(?:(?:can|could|would|will)\\s+you\\s+(?:please\\s+)?|i\\s+(?:want|need|\\u0027d\\s+like)\\s+(?:you\\s+to\\s+)?|let\\u0027?s\\s+)?'
const COUNT = '(?:(?:me\\s+)?(?:a|an|another|one|two|three|four|five|six|seven|eight|nine|ten|\\d+|some|a\\s+few|a\\s+couple\\s+of)\\s+)?(?:(?:new|fresh|more|extra|other|separate|parallel|plain|interactive|claude|codex|shell|tmux|herdr)\\s+)*'
const SESSION_ASK = new RegExp(LEAD_IN + '(open|start|spawn|launch|fire\\s+up|give\\s+me|get\\s+me|bring\\s+up)\\s+(?:up\\s+)?' + COUNT + SESSION_NOUN + '\\b' + NOT_A_PANE + FOLLOW, 'i')
const STORM_TYPED = /^\s*\/(agentille:)?storm\b/
export function asksSessions(text) {
  const t = String(text ?? '')
  return STORM_TYPED.test(t) || SESSION_ASK.test(t)
}

// Every ask for sessions in a typed prompt, as { start, end } offsets: start at the verb, end right after the noun.
const SESSION_ASKS = new RegExp(SESSION_ASK.source, 'gi')
export function sessionAskSpans(text) {
  const t = String(text ?? '')
  const out = []
  for (const m of t.matchAll(SESSION_ASKS)) {
    const end = m.index + m[0].length
    const verb = m.index + m[0].toLowerCase().lastIndexOf(m[1].toLowerCase(), m[0].length - 1)
    out.push({ start: Math.max(m.index, verb), end })
  }
  return out
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

// Fix rounds count per piece (factory.md → "Fix rounds": at most 2 per piece), so two pieces in fix rounds never push each
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
    (role === 'planner' && hdr.mode === 'diagnose' && run.fixes >= 2) ? run.fixes + ' failed fixes' :
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
