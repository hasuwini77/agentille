// agentille highlight — make a long /agt reply scannable. Pure on purpose: register.js
// draws; these helpers decide what to light and what goes on the essentials card.
//
//   essentials — the next action, the one flag, the one done line, read off the text. No model.
//   lightTokens — wrap paths, versions, refs and numbers in backticks so the dim body
//                 shows them lit. Code, links and fences are never touched.

import { words } from './focus.js'

export const CARD_MIN_WORDS = 40
export const LIT_MAX = 10_000
export const LIT_MEMO_MAX = 500
export const MARK = { next: '→', flag: '⚑', done: '✓' }
export const SPAN_COLOR = { path: '#7fd3e6', cmd: '#4f8ef7', version: '#a77bff', number: '#f2a33a', ref: '#3fb950' }
export const HIGHLIGHT_USAGE = 'Usage: /agt-highlight [on|off]'

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
    if (open) {
      const c = /^\s*(`+|~+)\s*$/.exec(l)
      if (c && c[1][0] === open[0] && c[1].length >= open.length) open = null
      return true
    }
    const m = /^\s*(`{3,}|~{3,})/.exec(l)
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
    t.includes('⚑') ||
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

export function highlight(text) {
  if (words(text) < CARD_MIN_WORDS) return null
  const card = essentials(text)
  const lit = lightTokens(text)
  const body = lit.length <= LIT_MAX ? lit : null
  if (!card.length && body === null) return null
  return { card, body }
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

export function parseHighlightArgs(args) {
  const a = String(args ?? '').trim().toLowerCase()
  if (!a) return { show: true }
  if (a === 'on') return { on: true }
  if (a === 'off') return { on: false }
  return { error: HIGHLIGHT_USAGE }
}

export function highlightText(on) {
  return on
    ? 'Highlight: on — /agt replies get an essentials card and a dim body with paths, versions, refs and numbers lit.'
    : 'Highlight: off — replies draw as usual. /agt-highlight on turns it back on.'
}
