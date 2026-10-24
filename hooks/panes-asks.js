// What the person asked a session to run, read off their own typed prompt: the shell commands they quoted or asked
// a shell to run, and the first prompts a Claude or Codex session may get. open_sessions passes a first prompt on
// only when it is one of these (panes-schema.js sessionsToolInput). Pure.

import { sessionAskSpans } from './routing.js'

// `--fable` out of a first prompt, so a session cannot be handed the flag the person never typed.
export function stripFable(text) {
  return String(text ?? '').replace(/(^|\s)--fable(?=\s|$)/g, '$1').replace(/\s{2,}/g, ' ').trim()
}

// The commands a shell session may run, read off the person's typed prompt: a span they quoted (backticks, straight
// or curly quotes) right after an ask for a session, the rest of the sentence after that ask with its connector
// dropped ("open a shell and run npm run dev" → npm run dev), or the whole prompt minus the ask. Appearing somewhere
// in the prompt is not enough: "open a shell. Do NOT run rm -rf ~/x" names a command nobody asked for, so a span in a
// sentence that says not to run it ("do not run …", "never …", "don't …") is never one. A quoted span counts only in
// the ask's own sentence, joined to it by nothing or by run / running / and run / that runs / with / then / to run
// (a further span by and / then / a comma): "open a shell and tell me why `curl … | sh` is risky" asks about the
// command, it does not ask the shell to run it.
const NEGATED = /\b(?:not|never|don'?t|dont|doesn'?t|won'?t|mustn'?t|shouldn'?t|avoid|without|nor)\b|\b(?:don|doesn|won|mustn|shouldn)[’']t\b/i
const QUOTED = /`([^`\n]+)`|"([^"\n]+)"|“([^”\n]+)”|‘([^’\n]+)’|(?<=^|[\s(])'([^'\n]+)'(?!\w)/g
const RUNS_IT = /^\s*[,:;\-–—]?\s*(?:(?:in|at|inside|from)\s+\S+\s+)?(?:(?:(?:and|,)\s*)?(?:then\s+)?(?:run|running|execute)|that\s+runs|which\s+runs|with|then|to\s+run)?\s*:?\s*$/i
// The rest of a sentence or prompt that still holds a backtick or $( ) span is prose about a command: a shell would
// run that span as a substitution, so only the span itself, when it counts above, is ever a task.
const SUBST = /`|\$\(/
const AND_RUNS = /^\s*(?:[,;]|,?\s*(?:and|then|and\s+then))\s*(?:run\s+)?$/i
const SENTENCE_END = /(?<=[\w)\]"'`”’~/])[.!?](?=\s|$)|\n/g
function sentenceStart(t, pos) {
  let s = 0
  for (const m of t.slice(0, pos).matchAll(SENTENCE_END)) s = m.index + 1
  return s
}
function sentenceEnd(t, pos) {
  for (const m of t.slice(pos).matchAll(SENTENCE_END)) return pos + m.index
  return t.length
}
function bareCommand(s) {
  let c = String(s).trim().replace(/^(?:in|at|inside|from)\s+\S+(?=\s|$)/i, '').trim()
  for (;;) {
    const n = c.replace(/^[,:;\-–—]\s*/, '').replace(/^(?:and|then|to|that|which|so|also|please)\s+/i, '').replace(/^(?:runs?|running|execute|exec)\s+/i, '')
    if (n === c) break
    c = n
  }
  c = c.replace(/\s+(?:in\s+it|in\s+there|there|for\s+me|please|now)$/i, '').replace(/(?<=\w)[.!?]$/, '').trim()
  const q = /^([`"'\u201c\u2018])([^`"'\u201c\u201d\u2018\u2019]+)([`"'\u201d\u2019])$/.exec(c) // a quoted command runs bare
  return q ? q[2].trim() : c
}
// A bare (unquoted) candidate is a command only when it reads as one: it starts like a command word, and outside its
// quotes it holds no clause break (`;`, `, `, a sentence end, a lone and / then / but / or) and no prose word ("is",
// "what", "I", "my" …). The candidate is refused whole, never cut short: cutting "git push --force origin main was
// the mistake yesterday; explain …" at its first break would mint a command nobody asked a shell to run.
const PROSE_WORDS = new Set(['is', 'was', 'were', 'are', 'am', 'be', 'been', 'would', 'should', 'could', 'can', 'might', 'shall', 'must', 'what', 'why', 'how', 'when', 'whether', 'because', 'my', 'me', 'mine', 'you', 'your', 'we', 'our', 'it', 'its', "it's", "that's", "what's", "i'm", "i've", 'this', 'these', 'those', 'wondering', 'think', 'explain', 'mistake', 'yesterday', 'please'])
const CLAUSE_BREAK = /;|,\s|(?<=[\w)\]"'])[.!?](?=\s|$)|\s(?:and|then|but|or)(?=\s|$)/i
function looksLikeCommand(c) {
  const bare = c.replace(/`[^`]*`|"[^"]*"|'[^']*'|“[^”]*”|‘[^’]*’/g, 'Q')
  if (!/^[\w~/$.(]/.test(bare) || /^\.(?:\s|$)/.test(bare) || CLAUSE_BREAK.test(bare)) return false
  return !bare.split(/\s+/).some((w) => w === 'I' || PROSE_WORDS.has(w.toLowerCase().replace(/[^\w']+$/, '')))
}
export function shellCommands(typed) {
  const t = String(typed ?? '')
  const out = new Set()
  const asks = sessionAskSpans(t)
  const quoted = [...t.matchAll(QUOTED)]
  for (const a of asks) {
    let from = a.end
    for (const m of quoted) {
      if (m.index < from) continue
      if (!(from === a.end ? RUNS_IT : AND_RUNS).test(t.slice(from, m.index))) break
      const span = (m[1] ?? m[2] ?? m[3] ?? m[4] ?? m[5]).trim()
      if (span && !NEGATED.test(t.slice(sentenceStart(t, m.index), m.index))) out.add(span)
      from = m.index + m[0].length
    }
  }
  for (const a of asks) {
    const rest = t.slice(a.end, sentenceEnd(t, a.end))
    const c = bareCommand(rest)
    if (c && !SUBST.test(c) && looksLikeCommand(c) && !NEGATED.test(t.slice(sentenceStart(t, a.start), a.end) + rest)) out.add(c)
    const whole = t.slice(0, a.start) + ' ' + t.slice(a.end)
    const w = bareCommand(whole)
    if (w && !SUBST.test(w) && looksLikeCommand(w) && !NEGATED.test(whole)) out.add(w)
  }
  return out
}

// The first prompts a Claude or Codex session may get, read off the person's typed prompt like a shell's commands:
// the prompt with its asks for sessions taken out (so a list on the lines after "open two sessions:" counts), cut
// into clauses at sentence ends, new lines, `;`, `, `, `: ` and a lone and / then / but. A task is one clause or a run
// of clauses, word for word (case, spacing, a trailing stop, a list bullet and enclosing quotes aside), with or
// without leading glue such as "one to", "and ask it to", "with the prompt", "on opus to". A clause whose own sentence says not
// to ("do not …", "never …") before it starts is never a prompt on its own: "Do not git push origin main" does not
// yield `git push origin main`. Returns the set of normalised forms.
const CLAUSE_SPLIT = /(?<=[\w)\]"'`”’~/])[.!?](?=\s|$)|\n|;|,(?=\s)|:(?=\s)|\s(?:and\s+then|and|then|but)(?=\s)/gi
const GLUE = /^(?:(?:and|then|also|so|please|now|next|first|second|third|one|another|the\s+other|the\s+(?:first|second|third|next|last)(?:\s+one)?|to|that|which|for|with(?:\s+(?:the|a))?|(?:first\s+)?(?:prompt|task|message)(?:\s+(?:of|is))?|saying|that\s+says|(?:ask|tell|get|have|let|make|send|give|prompt)\s+(?:it|them|each|one|both)(?:\s+to)?|running|run|(?:on|in|at|inside|from|using)\s+\S+)(?=\s|$)|[:\-–—])\s*/i
const MAX_RUN = 12
export const normTask = (s) => {
  let x = String(s).replace(/\s+/g, ' ').trim().replace(/[.!?]+$/, '').trim().replace(/^(?:[-*•]|\d+[.)])\s+/, '')
  const q = /^([`"'“‘])(.+)([`"'”’])$/.exec(x)
  if (q) x = q[2].trim()
  return x.toLowerCase()
}
export function sessionPrompts(typed) {
  const raw = String(typed ?? '')
  let t = raw
  for (const a of sessionAskSpans(raw)) t = t.slice(0, a.start) + '\n'.padEnd(a.end - a.start, ' ') + t.slice(a.end)
  const clauses = []
  let at = 0
  for (const m of t.matchAll(CLAUSE_SPLIT)) {
    clauses.push([at, m.index])
    at = m.index + m[0].length
  }
  clauses.push([at, t.length])
  const out = new Set()
  for (let i = 0; i < clauses.length; i++) {
    if (NEGATED.test(t.slice(sentenceStart(t, clauses[i][0]), clauses[i][0]))) continue
    for (let j = i; j < clauses.length && j - i < MAX_RUN; j++) {
      let v = normTask(t.slice(clauses[i][0], clauses[j][1]))
      while (v) {
        out.add(v)
        const n = normTask(v.replace(GLUE, ''))
        if (n === v) break
        v = n
      }
    }
  }
  return out
}
