// The wire: how agentille sessions talk to each other. A worker pane publishes its live status
// to the shared $.store (the lead's band reads it) and messages the lead when it finishes, so
// the lead wakes on its own instead of polling the multiplexer. A blocked worker needs the
// person, not the lead: the multiplexer reports it and the band flags it. Pure on purpose:
// register.js makes every $ call.

import { elapsed, tokens } from './live.js'

export const WIRE_TAG = '[agt wire]'
export const STATUS_PREFIX = 'wire:'
export const STATUS_TTL_MS = 6 * 3_600_000
export const PUBLISH_MS = 1000
export const ANSWER_HEAD = 1500
export const LOG_MAX = 40
const SESSION_RE = /^[A-Za-z0-9_-]{1,128}$/
const NAME_RE = /^agt-[A-Za-z0-9_-]{1,60}$/

export const statusKey = (name) => STATUS_PREFIX + name

// What a worker publishes about itself, at most once per PUBLISH_MS while it works.
export function workerStatus({ name, session = null, state, tool = null, tok = 0, model = null, effort = null, start = null, now }) {
  return { name, session, state, tool, tok, model, effort, start, at: now }
}

// A published status is trusted only while it is recent and names the pane it was read for.
export function freshStatus(rec, name, now) {
  return !!rec && typeof rec === 'object' && rec.name === name && typeof rec.at === 'number' && now - rec.at < STATUS_TTL_MS
}

// The env a lead hands each worker it opens: its own name and the lead's session, so the
// worker knows where to send. A session id that is not a plain token is left out.
export function wireEnv({ name, lead }) {
  const out = []
  if (NAME_RE.test(String(name ?? ''))) out.push('AGENTILLE_NAME=' + name)
  if (SESSION_RE.test(String(lead ?? ''))) out.push('AGENTILLE_LEAD=' + lead)
  return out
}

export function validLead(id) {
  return SESSION_RE.test(String(id ?? '')) ? String(id) : null
}

// The message a finished worker sends its lead: one header line, the head of its answer, and
// where the full answer was saved. The lead reads it as a peer message and wakes for it.
export function doneMessage({ name, ms = 0, model = null, effort = null, tok = 0, answer = '', reportPath = null }) {
  const body = String(answer ?? '').trim()
  const head = body.length > ANSWER_HEAD ? body.slice(0, ANSWER_HEAD) + '…' : body
  const meta = [elapsed(ms), [model, effort].filter(Boolean).join(' '), tok ? tokens(tok) + ' tok' : ''].filter(Boolean).join(' · ')
  return [WIRE_TAG + ' ' + name + ' done · ' + meta, head, reportPath ? 'Full answer: ' + reportPath : ''].filter(Boolean).join('\n')
}

// A received wire message → { from, kind, summary }, or null for anything else.
export function parseWire(text) {
  const s = String(text ?? '')
  const at = s.indexOf(WIRE_TAG)
  if (at < 0) return null
  const lines = s.slice(at + WIRE_TAG.length).trim().split('\n')
  const m = /^(\S+)\s+(done|note)\b\s*·?\s*(.*)$/.exec(lines[0] ?? '')
  if (!m) return null
  const [, from, kind, rest] = m
  const first = lines.slice(1).map((l) => l.trim()).find((l) => l && !l.startsWith('Full answer:'))
  const summary = kind === 'done' ? first ?? rest : rest || first || kind
  return { from, kind, summary: summary.replace(/^[#>*\s-]+/, '').slice(0, 160) }
}

// Short names for the band: agt-r1-exec-1 → exec-1.
export function shortName(name) {
  const parts = String(name ?? '').split('-')
  return parts[0] === 'agt' && parts.length > 2 ? parts.slice(2).join('-') : String(name ?? '')
}

// A wire log entry, newest last, capped.
export function logWire(log, entry) {
  log.push(entry)
  if (log.length > LOG_MAX) log.splice(0, log.length - LOG_MAX)
  return log
}

// /agt-tell <worker> <message> → { name, text } | { usage } | { error }. The worker may be named
// in full or by its role (exec-1); `panes` are the agt- panes the lead sees now.
export const TELL_USAGE = 'Usage: /agt-tell <worker> <message>   (worker: exec-1 or agt-<run>-exec-1)'
export function parseTellArgs(args, panes = []) {
  const m = /^\s*(\S+)\s+([\s\S]+?)\s*$/.exec(String(args ?? ''))
  if (!m) return { usage: TELL_USAGE }
  const [, who, raw] = m
  const text = raw.replace(/^(["'])([\s\S]*)\1$/, '$2').trim()
  const hits = panes.filter((p) => p.name === who || shortName(p.name) === who)
  if (hits.length === 0) return { error: 'No worker named ' + who + '. ' + TELL_USAGE }
  if (hits.length > 1) return { error: who + ' matches ' + hits.length + ' workers; use the full agt- name.' }
  return text ? { name: hits[0].name, text } : { usage: TELL_USAGE }
}

// ── lead self-wake ────────────────────────────────────────────────────────────

export const WAKE_TAG = '[agt wake]'
export const WAKE_MS = 20_000

// Panes of the lead that finished or blocked ≥ WAKE_MS ago without a wire done message, and that
// the lead has not been woken for yet. `seen` is the reaper's pane id → { since }.
export function wakeDue(pool, seen, wireDone, woken, now) {
  return pool.filter((p) => {
    if (p.state !== 'done' && p.state !== 'blocked') return false
    const since = seen.get(p.id)?.since
    return typeof since === 'number' && now - since >= WAKE_MS && !wireDone.has(p.name) && !woken.has(p.name)
  })
}

// How to read a pane from its transport; `id` is the herdr pane id or the tmux pane id.
export function readCommand(transport, id) {
  if (!/^[A-Za-z0-9:%._-]{1,40}$/.test(String(id ?? ''))) return null
  if (transport === 'herdr') return 'herdr pane read ' + id + ' --lines 200'
  if (transport === 'tmux') return 'tmux capture-pane -p -t ' + id + ' -S -200'
  return null
}

// The message the lead sends its own session when a worker went quiet without reporting.
export function wakeMessage({ name, state, transport, id, answerPath = null }) {
  const what = state === 'blocked' ? 'is blocked (an approval or question is on screen) and has not reported' : 'finished and has not reported'
  const read = answerPath ? 'Its answer is saved at ' + answerPath + '; read that.' : readCommand(transport, id) ? 'Read it with: ' + readCommand(transport, id) : 'Read the pane.'
  return WAKE_TAG + ' ' + name + ' ' + what + '. ' + read + (state === 'blocked' ? ' A blocked worker needs the person.' : ' Then harvest it and close_pane.')
}
