// agentille routing policy — pure functions, no mods API.
// register.js feeds it what the mod observed; it returns { model, effort, reason }.
// The table and ladder mirror skills/agt/routing.md → "Default routing" (that doc is the spec).

import { modelKey } from './mascot.js'

const ROLE_PREFIX = 'agentille:agentille-'

// [model, effort] per role: default · size=large · risk auth/money · thinkingDepth=quick
const TABLE = {
  planner:             { base: ['opus', 'high'],     large: ['opus', 'xhigh'], risk: null,              quick: ['sonnet', 'medium'] },
  'plan-reviewer':     { base: ['sonnet', 'medium'], large: ['opus', 'high'],  risk: null,              quick: ['sonnet', 'medium'] },
  'ui-prototyper':     { base: ['opus', 'high'],     large: ['opus', 'high'],  risk: null,              quick: ['sonnet', 'medium'] },
  executor:            { base: ['sonnet', 'medium'], large: ['sonnet', 'high'], risk: ['sonnet', 'high'], quick: ['sonnet', 'medium'] },
  'code-reviewer':     { base: ['sonnet', 'medium'], large: ['opus', 'high'],  risk: ['opus', 'high'],   quick: ['sonnet', 'medium'] },
  'design-reviewer':   { base: ['opus', 'high'],     large: ['opus', 'high'],  risk: ['opus', 'high'],   quick: ['sonnet', 'high'] },
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
// maxRunUsd is the run's cost ceiling in US dollars (see runCeiling below): 15 by default, about two heavy runs' worth
// of Opus review at list prices; the person's `null` (or anything but a positive number) turns it off. stopAtCeiling
// true turns the ceiling from a demotion into a stop: every later dispatch of the run is denied (runStop below).
export const DEFAULTS = { autoFable: false, maxFablePerRun: 1, fableWeeklyCeiling: 60, advisorOnOpus: true, maxRunUsd: 15, stopAtCeiling: false }

// US dollars per million tokens, by model family, at the current generation's first-party API list price (Fable 5.1,
// Opus 5.5, Sonnet 5.5, Haiku 5.5 up to 100K-token prompts). An estimate, not a bill: a plan subscription is not billed
// per token, cache writes are priced as plain input (they cost about 1.25×), and pane workers report no tokens to the
// lead, so they are estimated from their elapsed time (paneUsd). A model the mod cannot name is priced as Opus.
export const PRICES = {
  fable:  { input: 10, output: 50, cacheRead: 0.25 },
  opus:   { input: 4, output: 20, cacheRead: 0.20 },
  sonnet: { input: 2, output: 10, cacheRead: 0.20 },
  haiku:  { input: 0.10, output: 0.50, cacheRead: 0.01 },
}

const priced = (model, t) => {
  const p = PRICES[modelKey(model)] ?? PRICES.opus
  return ((t.input ?? 0) * p.input + (t.output ?? 0) * p.output + (t.cacheRead ?? 0) * p.cacheRead) / 1_000_000
}

// A pane worker (Herdr or tmux) reports no tokens to the lead, so its spend is estimated: the tokens a worker of its
// role uses per minute, priced at the model the table routed it to, times the minutes it has been open (from its
// route's start to its end, or to `now` while it runs), at most PANE_EST_MAX_MS. A builder (executor, adversary) reads
// and writes more per minute than a role that judges. A Codex pane runs on the person's own Codex account, not on
// Claude: it costs nothing here.
export const PANE_TOKENS_PER_MIN = {
  build: { input: 10_000, output: 2_500, cacheRead: 80_000 },
  judge: { input: 8_000, output: 1_500, cacheRead: 60_000 },
}
export const PANE_EST_MAX_MS = 60 * 60_000
export function paneUsd(route, now = Date.now()) {
  if (!route || route.model === 'codex' || typeof route.start !== 'number') return 0
  const ms = Math.min(PANE_EST_MAX_MS, Math.max(0, (route.end ?? now) - route.start))
  const rate = PANE_TOKENS_PER_MIN[route.agent === 'executor' || route.agent === 'adversary' ? 'build' : 'judge']
  return priced(route.model, rate) * (ms / 60_000)
}

// The lead session's own spend on a run: the tokens its main-loop steps used while the run was in progress
// (dispatch.js addLeadUsage), priced at the lead's model. `lead` maps run id → { input, output, cacheRead, model }.
export function leadUsd(lead, run) {
  const t = lead?.get(run)
  return t ? priced(t.model, t) : 0
}

// The run's estimated spend so far: the live agents' token counts (live.js: `input` holds uncached input plus cache
// writes, `cacheRead` the cache reads), filed the way the ledger files them, each of the run's pane workers by
// paneUsd, and the lead's own tokens on the run by leadUsd. `routes` is the lead's pane routes; `now` is Date.now(),
// the clock a route's start is read on.
export function estimateRunUsd(agents, run, routes = [], now = Date.now(), lead = null) {
  let usd = leadUsd(lead, run)
  for (const a of agents?.values() ?? []) if ((a.fileRun ?? a.run) === run) usd += priced(a.model, a)
  for (const r of routes ?? []) if (r.run === run) usd += paneUsd(r, now)
  return usd
}

export const maxRunUsdOf = (settings) => {
  const v = settings?.maxRunUsd
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null
}

// Past the ceiling, every role the table or the ladder puts on Opus (or a ladder Fable) drops to Sonnet at the same
// effort: the planner, every reviewer (the design-reviewer and a duel's code-reviewer judge included), the
// ui-prototyper and the adversary. The executor never changes model. `from` names the model it would have run.
export const CEILING_ROLES = new Set(ROLES.filter((r) => r !== 'executor'))
export const usd = (n) => '$' + (Math.round(n * 100) / 100).toFixed(2)
function runCeiling(d, role, run, settings) {
  const max = maxRunUsdOf(settings)
  if (max == null || !CEILING_ROLES.has(role) || (d.model !== 'opus' && d.model !== 'fable')) return d
  if (!(typeof run.usd === 'number' && run.usd >= max)) return d
  const why = 'run ~' + usd(run.usd) + ' ≥ maxRunUsd ' + usd(max)
  return { model: 'sonnet', effort: d.effort, reason: d.reason === 'table' ? why : d.reason + ' · ' + why, fable: false, capped: true, from: d.model }
}

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
// opens its pane. Nothing keeps it in flight forever: AGT_INFLIGHT_MAX_MS after the typed /agt (`st.agtTypedAt`) it
// is over whatever is still listed (a tmux worker that never wrote its done file reads as working for good), and a
// pane sitting at a prompt (Herdr `blocked`: a permission ask nobody answers) stops counting once `restMs(pane)`
// says it has been there PANE_REST_MS. `st` is the mod's state record (S); `now` is Date.now(), the clock agents
// are heard by; `restMs` is how long a pane has been in its current state on the reaper's clock, or null when unknown;
// `clockNow` is that clock's now ($.clock.now(), the one `st.agtTypedAt` was read on; `now` when omitted).
export const AGT_GRACE_TYPED = 3
export const AGENT_SILENT_MS = 10 * 60_000
export const AGT_INFLIGHT_MAX_MS = 60 * 60_000
export const PANE_REST_MS = 15 * 60_000
const PANE_RESTING = new Set(['done', 'idle', 'dead'])
const PANE_AT_PROMPT = new Set(['blocked'])
export function runInFlight(st, now = Date.now(), restMs = () => null, clockNow = now) {
  if (!st?.agtTyped) return false
  if (typeof st.agtTypedAt === 'number' && typeof clockNow === 'number' && clockNow - st.agtTypedAt >= AGT_INFLIGHT_MAX_MS) return false
  const parked = (p) => PANE_AT_PROMPT.has(p.state) && (restMs(p) ?? 0) >= PANE_REST_MS
  if ((st.panes ?? []).some((p) => p.role !== 'spawn' && !PANE_RESTING.has(p.state) && !parked(p))) return true
  const run = st.lastRun
  if (run && run !== 'adhoc' && [...(st.live?.values() ?? [])].some((a) => a.run === run && a.state === 'working' && now - (a.heard ?? a.start ?? 0) < AGENT_SILENT_MS)) return true
  return (st.agtTypedSince ?? 0) < AGT_GRACE_TYPED
}

// The roster runs at most this many executors at once (SKILL.md → "Hard rules"). The mod never refuses a dispatch:
// the one past the cap is flagged. `agents` is the live map (subagents: working and heard from within AGENT_SILENT_MS,
// since a cancelled one raises no turn.complete), `routes` the pane routes (an executor pane counts until it leaves the
// stage). `run` is the run id; `now` is Date.now().
export const MAX_EXECUTORS_AT_ONCE = 3
export function executorsWorking(agents, routes, run, now = Date.now()) {
  const subs = [...(agents?.values() ?? [])].filter((a) => a.run === run && a.role === 'executor' && a.state === 'working' && now - (a.heard ?? a.start ?? 0) < AGENT_SILENT_MS).length
  const panes = (routes ?? []).filter((r) => r.run === run && r.agent === 'executor' && r.end == null).length
  return subs + panes
}

export function ordinal(n) {
  const t = n % 100
  if (t >= 11 && t <= 13) return n + 'th'
  return n + ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] ?? 'th')
}

// The flag for an executor dispatch that makes `count` executors at once in `run`, or null within the cap.
export function executorCapFlag(run, count) {
  return count > MAX_EXECUTORS_AT_ONCE ? 'run ' + run + ': ' + ordinal(count) + ' executor at once; the roster says ' + MAX_EXECUTORS_AT_ONCE : null
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
const NOT_A_PANE = '(?!\\s+(?:file|script|config|cookie|build|table|folder|handler|store|id|token|state|list|middleware|module|log|project|emulator|summary|summaries|test|suite|injection|manager|timeout|storage|replay|hijack|hijacking|fixation|key|data|history|variable|output|command|app|library|lib|layout|component|logic|bug|issue|leak|support|type|class|api|code|feature|ticket|recording)s?\\b|\\.\\w)'
const FOLLOW = '(?=\\s*$|\\s*[,!?;:)\\]`"“‘(]|\\.(?!\\w)|\\s+[-–—]\\s|\\s+(?:for|with|in|at|on|named|called|running|that|to|and|so|here|there|beside|next|below|under|alongside|inside|from|then|now|please|too|which|where|each|via|using)\\b|\\s+(?:\\d+|one|two|three|four|five|six|seven|eight|claude|codex|shell|windows?|tabs?)\\b)'
const LEAD_IN = '(?:^|[.!?;:\\n]\\s*)(?:(?:please|pls|now|then|also|and|next|first|ok|okay)[,\\s]+)*(?:(?:can|could|would|will)\\s+you\\s+(?:please\\s+)?|i\\s+(?:want|need|\\u0027d\\s+like)\\s+(?:you\\s+to\\s+)?|let\\u0027?s\\s+)?'
const COUNT = '(?:(?:me\\s+)?(?:a|an|another|one|two|three|four|five|six|seven|eight|nine|ten|\\d+|some|a\\s+few|a\\s+couple\\s+of)\\s+)?(?:(?:new|fresh|more|extra|other|separate|parallel|plain|interactive|claude|codex|shell|terminal|tmux|herdr)\\s+)*'
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

// run: { revise, fixes, fable, usd? } observed so far (usd: estimateRunUsd, for the maxRunUsd ceiling) · settings:
// profile.routing merged over DEFAULTS · weeklyPct: seven_day percent used, or null when unknown. A typed --fable is
// the person's choice and passes the ceiling; every other pick goes through runCeiling last.
// With `stopAtCeiling: true`, a run at or past maxRunUsd dispatches nothing more: every role (the executor and a
// typed --fable included) gets `stop`, the line the dispatch is denied with. Off (the default), runCeiling demotes.
export function runStop(run, settings) {
  const max = maxRunUsdOf(settings)
  if (max == null || settings?.stopAtCeiling !== true) return null
  if (!(typeof run?.usd === 'number' && run.usd >= max)) return null
  return 'agt ✗ run ~' + usd(run.usd) + ' reached its cost ceiling, maxRunUsd ' + usd(max) + ', and routing.stopAtCeiling is on: no more dispatches this run. Raise routing.maxRunUsd in ~/.agentille/profile.json (or set stopAtCeiling to false) to go on.'
}

export function decide(o) {
  const { forced, ...d } = pick(o)
  const stop = runStop(o.run ?? {}, o.settings ?? DEFAULTS)
  if (stop) return { ...d, fable: false, stop }
  return forced ? d : runCeiling(d, o.role, o.run ?? {}, o.settings ?? DEFAULTS)
}

function pick({ role, hdr = {}, run = { revise: 0, fixes: 0, fable: 0 }, depth, settings = DEFAULTS, weeklyPct = null }) {
  let [model, effort] = base(role, hdr, depth)
  const reasons = []

  if (hdr.fable === 'forced' && FABLE_ROLES.has(role) && (!FORCED_FABLE_NEEDS_LARGE.has(role) || model === 'opus')) {
    return { model: 'fable', effort: 'high', reason: '--fable typed', fable: true, forced: true }
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
