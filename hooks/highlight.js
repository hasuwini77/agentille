// agentille highlight — make a long /agt reply scannable. Pure on purpose: register.js
// draws; these helpers decide what to light and what goes on the essentials card.
//
//   essentials — the next action, the one flag, the one done line, read off the text. No model.
//                 Skipped for a final card (an answer opening with ✓ or ✗): it would repeat it.
//   lightTokens — wrap paths, versions, refs and numbers in backticks so the dim body
//                 shows them lit. Code, links and fences are never touched.
//   panel       — the turn's final answer, framed: a head, the essentials, the body lit at full
//                 brightness. Narration between tool calls stays dim, so the eye lands on the answer.

import { words } from './focus.js'

export const CARD_MIN_WORDS = 40
export const LIT_MAX = 10_000
export const LIT_MEMO_MAX = 500
export const MARK = { next: '→', flag: '⚑', done: '✓' }
export const SPAN_COLOR = { path: '#7fd3e6', cmd: '#4f8ef7', version: '#a77bff', number: '#f2a33a', ref: '#3fb950' }
export const HIGHLIGHT_USAGE = 'Usage: /agt-highlight [on|all|off]'

const MAX_LINE = 96

const PATH_ABS = /^(~\/|\.{1,2}\/|\/)[\w@.\/-]*[\w@-](:\d+(-\d+)?)?$/
const PATH_REL = /^[\w@.-]+(\/[\w@.-]+)+\.[A-Za-z0-9]{1,8}(:\d+(-\d+)?)?$/
const VERSION = /^v?\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$|^v\d+(\.\d+)?$/
const REF = /^#\d+$/
const NUMBER = /^\d+([.,]\d+)?(×|x|%|k|K|M|ms|s|min)$/

function kindOf(core) {
  if (core.includes('://')) return null
  if (PATH_ABS.test(core) || PATH_REL.test(core)) return 'path'
  if (VERSION.test(core)) return 'version'
  if (REF.test(core)) return 'ref'
  if (NUMBER.test(core)) return 'number'
  return null
}

// Punctuation that hugs a token is not part of it: "(#75)," lights #75 only.
function peel(token) {
  const lead = /^(?:[(\[{"'*_]|~(?!\/))+/.exec(token)?.[0] ?? ''
  const rest = token.slice(lead.length)
  const trail = /[.,;:!?)\]}"'*_…]+$/.exec(rest)?.[0] ?? ''
  return { lead, core: rest.slice(0, rest.length - trail.length), trail }
}

// A fence opens at any indent (list items nest them) and closes only on the same
// character, at least as long, alone on its line. An unclosed fence runs to the end.
function fenceMask(lines) {
  let open = null
  return lines.map((l) => {
    // Quoted code blocks fence the same way: `> ```` opens one too.
    l = l.replace(/^\s*(?:>\s?)+/, '')
    if (open) {
      const c = /^\s*(`+|~+)\s*$/.exec(l)
      if (c && c[1][0] === open[0] && c[1].length >= open.length) open = null
      return true
    }
    // A backtick fence's info string has no backtick, so ```npm test``` is inline code.
    const m = /^\s*(`{3,})[^`]*$/.exec(l) ?? /^\s*(~{3,})/.exec(l)
    if (m) {
      open = m[1]
      return true
    }
    return false
  })
}

const PROTECTED = /(`[^`]*`|!?\[[^\]]*\]\([^)]*\)|<[^>\s]+>)/

function lightPlain(seg) {
  return seg
    .split(/(\s+)/)
    .map((tok) => {
      if (!tok.trim() || tok.includes('://') || tok.startsWith('www.')) return tok
      const { lead, core, trail } = peel(tok)
      return core && kindOf(core) ? lead + '`' + core + '`' + trail : tok
    })
    .join('')
}

export function lightTokens(md) {
  const lines = String(md ?? '').split('\n')
  const fenced = fenceMask(lines)
  return lines
    .map((l, i) => {
      if (fenced[i]) return l
      if (/^\s{0,3}\[[^\]]+\]:/.test(l)) return l
      if ((l.match(/`/g) ?? []).length % 2) return l
      return l.split(PROTECTED).map((seg, j) => (j % 2 ? seg : lightPlain(seg))).join('')
    })
    .join('\n')
}

function clip(s) {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length > MAX_LINE ? t.slice(0, MAX_LINE - 1) + '…' : t
}

const NEGATED = /\b(0|no|zero|without)\s+(\w+\s+)?(failures?|failed|failing|fails?|errors?|warnings?|blockers?)\b/gi

function isFlag(line) {
  const t = line.replace(NEGATED, '')
  return (
    /[⚑✗]/.test(t) ||
    /\b(blockers?|blocked|failed|failing)\b/i.test(t) ||
    /\b(FAIL|CONCERNS|REVISE)\b/.test(t) ||
    /needs you/i.test(t) ||
    /\b[1-9]\d*\s+(\w+\s+)?(errors?|warnings?)\b/i.test(t) ||
    /^(error|warning):/i.test(t)
  )
}

function isDone(line) {
  if (/\bnot\s+(yet\s+)?(done|merged|released|passing)\b/i.test(line)) return false
  return /[✓✅]/.test(line) || /\b(done|passes|passed|passing|merged|released|shipped|tagged|green)\b/i.test(line)
}

function nextText(line) {
  if (line.startsWith('→')) return line.slice(1).trim()
  const m = /^next(?: steps?)?\s*[:—-]\s*(.*)$/i.exec(line)
  if (m) return m[1].trim()
  return /next step/i.test(line) ? line : ''
}

// → [{ kind, text }]: at most one per kind, first line wins, next · flag · done.
export function essentials(text) {
  const lines = String(text ?? '').split('\n')
  const fenced = fenceMask(lines)
  const found = {}
  lines.forEach((raw, i) => {
    if (fenced[i]) return
    if (/^\s*#{1,6}(\s|$)/.test(raw)) return
    if (/^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(raw)) return
    const line = raw
      .replace(/^\s*(?:(?:[-*+]|\d+[.)])\s+|>\s*)+/, '')
      .replace(/\*\*|__/g, '')
      .trim()
    if (!line) return
    const next = !found.next && nextText(line)
    if (next) {
      found.next = clip(next)
      return
    }
    if (!found.flag && isFlag(line)) {
      const t = clip(line.replace(/^⚑️?\s*/, ''))
      if (t) found.flag = t
      return
    }
    if (isFlag(line)) return // a second flag is still a flag, never the done line
    if (!found.done && isDone(line)) {
      const t = clip(line.replace(/^[✓✅]️?\s*/, ''))
      if (t) found.done = t
    }
  })
  return ['next', 'flag', 'done'].filter((k) => found[k]).map((kind) => ({ kind, text: found[kind] }))
}

// A line → coloured pieces. Backtick delimiters are dropped; the texts rejoin to the line.
export function spans(line) {
  const out = []
  const push = (text, kind) => {
    if (!text) return
    const last = out[out.length - 1]
    if (kind === 'plain' && last?.kind === 'plain') last.text += text
    else out.push({ text, kind })
  }
  String(line ?? '').split(/`([^`]*)`/).forEach((seg, j) => {
    if (j % 2) return push(seg, kindOf(seg) ?? 'cmd')
    for (const tok of seg.split(/(\s+)/)) {
      if (!tok.trim()) {
        push(tok, 'plain')
        continue
      }
      const { lead, core, trail } = peel(tok)
      const kind = !core ? 'plain' : /^\/[a-z][\w:-]*$/.test(core) ? 'cmd' : (kindOf(core) ?? 'plain')
      push(lead, 'plain')
      push(core, kind)
      push(trail, 'plain')
    }
  })
  return out
}

// The run's final card opens with ✓ (done) or ✗ (failed): it is its own summary, so no
// essentials card and no word floor, only the tokens lit.
const isFinalCard = (text) => /^[✓✗]/.test(String(text ?? '').trimStart())

export function highlight(text) {
  const final = isFinalCard(text)
  if (!final && words(text) < CARD_MIN_WORDS) return null
  const card = final ? [] : essentials(text)
  const lit = lightTokens(text)
  const body = lit.length <= LIT_MAX ? lit : null
  if (!card.length && body === null) return null
  return { card, body }
}

// highlight() is regex work and the transcript redraws on every ticker tick, so the result
// is kept per message id while its text is unchanged (a streaming reply recomputes).
export function highlightFor(memo, id, text) {
  if (!id) return highlight(text)
  const hit = memo.get(id)
  if (hit && hit.text === text) return hit.h
  const h = highlight(text)
  memo.delete(id)
  memo.set(id, { text, h })
  if (memo.size > LIT_MEMO_MAX) memo.delete(memo.keys().next().value)
  return h
}

// The lit/dim decision is made once per message id, on its first sight, so a reply
// does not flip style when a later turn changes.
export function litFor(memo, id, { on, agtTurn }) {
  if (!id) return !!(on && agtTurn)
  if (!memo.has(id)) {
    memo.set(id, !!agtTurn)
    if (memo.size > LIT_MEMO_MAX) memo.delete(memo.keys().next().value)
  }
  return !!on && memo.get(id)
}

// The block that closes the main turn's answer: its text is the answer's tail (a reply drawn in
// several blocks frames only its last).
export function isAnswerBlock(answer, text) {
  const a = String(answer ?? '').trim()
  const t = String(text ?? '').trim()
  return !!a && !!t && a.endsWith(t)
}

const clock = (ms) => {
  const s = Math.max(0, Math.round((ms ?? 0) / 1000))
  return s < 60 ? s + 's' : Math.floor(s / 60) + 'm ' + String(s % 60).padStart(2, '0') + 's'
}

// How a main-session answer should be shaped, sent beside each typed prompt under
// display.highlight: all. The panel reads the same shape back: a headline, bullets, a move block.
export const ANSWER_STYLE = [
  '[agentille answer style] Shape your final answer for a two-second read:',
  '- Line 1: the answer or outcome in at most 15 words. No preamble.',
  '- Then at most 6 bullets, one fact each, at most 15 words. No paragraphs, no step-by-step recap of what you did.',
  '- If the user must act, end with a line "Your move:" then numbered steps, one action each, any command in backticks.',
  '- If nothing is needed from the user, leave the "Your move:" section out.',
  '- Code, tables and headings only when they carry the answer itself.',
].join('\n')

// A move block opens on a line naming the user's turn ("Your move:", "Action needed:", "You do:").
const MOVE = /^\s*(?:#{1,6}\s*)?(?:[*_]{1,2})?\s*(?:▶\s*)?(?:your move|action needed|you do|on your end|to do on your side)\b(?:[*_]{1,2})?\s*[:—-]?\s*(?:[*_]{1,2})?\s*(.*)$/i
const STEP = /^\s*(?:[-*+]|\d+[.)])\s+/

// The text → { main, move }: the move block's steps (list markers dropped), or null when there is none.
// It runs from its opening line to the end, or to the next heading. Fenced lines never open one.
export function splitMove(text) {
  const lines = String(text ?? '').split('\n')
  const fenced = fenceMask(lines)
  const at = lines.findIndex((l, i) => !fenced[i] && MOVE.test(l))
  if (at < 0) return { main: String(text ?? ''), move: null }
  let stop = lines.length
  for (let i = at + 1; i < lines.length; i++) if (!fenced[i] && /^\s*#{1,6}\s/.test(lines[i])) { stop = i; break }
  const inline = MOVE.exec(lines[at])[1].replace(/[*_]{2}/g, '').trim()
  const steps = [inline, ...lines.slice(at + 1, stop)].map((l) => l.replace(STEP, '').replace(/\*\*|__/g, '').trim()).filter(Boolean)
  const main = [...lines.slice(0, at), ...lines.slice(stop)].join('\n').replace(/\s+$/, '')
  return { main, move: steps.length ? steps : null }
}

// The first line becomes the panel's headline when it reads as one: short, not code, a table or a list.
function headline(main) {
  const lines = main.split('\n')
  const i = lines.findIndex((l) => l.trim())
  if (i < 0) return { head: null, rest: main }
  const raw = lines[i].trim()
  if (/^(```|~~~|\||>|[-*+]\s|\d+[.)]\s)/.test(raw)) return { head: null, rest: main }
  const head = raw.replace(/^#{1,6}\s+/, '').replace(/\*\*|__/g, '').trim()
  if (!head || head.length > 120) return { head: null, rest: main }
  return { head, rest: lines.slice(i + 1).join('\n').replace(/^\s+|\s+$/g, '') }
}

// The final answer's panel. tone colours the frame (fail · ok · move · flag · plain); head is the
// answer's own first line (or "answer"); time is the turn's; card is the essentials strip, kept only for
// an unshaped long answer; body is lit; move is the user's steps; idle says "nothing needed from you"
// for a shaped answer that has no move.
export function panel(text, { ms, shaped = false } = {}) {
  const t = String(text ?? '')
  const { main, move } = splitMove(t)
  const { head, rest } = headline(main)
  const lead = t.trimStart()
  const card = shaped || move || isFinalCard(t) || words(t) < CARD_MIN_WORDS ? [] : essentials(t)
  const lit = lightTokens(rest)
  const tone = lead.startsWith('✗') ? 'fail' : move ? 'move' : lead.startsWith('✓') ? 'ok' : card.some((c) => c.kind === 'flag') ? 'flag' : 'plain'
  return {
    tone,
    head: head ?? 'answer',
    time: typeof ms === 'number' && ms > 0 ? clock(ms) : null,
    card,
    body: rest ? (lit.length <= LIT_MAX ? lit : rest) : null,
    move,
    idle: shaped && !move,
  }
}

export function parseHighlightArgs(args) {
  const a = String(args ?? '').trim().toLowerCase()
  if (!a) return { show: true }
  if (a === 'on') return { on: true, all: false }
  if (a === 'all') return { on: true, all: true }
  if (a === 'off') return { on: false, all: false }
  return { error: HIGHLIGHT_USAGE }
}

export function highlightText(on, all = false) {
  if (!on) return 'Highlight: off — replies draw as usual. /agt-highlight on turns it back on.'
  if (all) return 'Highlight: all — every long reply is lit, and each answer comes short and framed: a headline, bullets, and a ▶ your move box when you have something to do.'
  return 'Highlight: on — /agt replies get an essentials card and a dim body with paths, versions, refs and numbers lit, and the final answer is framed. /agt-highlight all shapes every answer.'
}
