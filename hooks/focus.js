// agentille focus — what in a long reply actually needs the reader. Pure on purpose:
// register.js makes the one model call and draws; these helpers decide and parse.
//
// Two sources, cheapest first:
//   flags  — read straight off agent results (a REVISE, a FAIL verdict, a failed check, a
//            blocked pane). No model call.
//   brief  — a Haiku pass over a long main-loop answer: next action, what got done, what
//            needs the reader. At most three lines.

export const FOCUS_MODES = ['all', 'agt', 'off']
export const DEFAULT_FOCUS = 'agt'
export const BRIEF_MIN_WORDS = 150
const MAX_LINE = 96
const MAX_INPUT = 12_000

export const BRIEF_SYSTEM = [
  'You condense an assistant reply for a reader with little time and little working memory.',
  'Output at most 3 lines, nothing else. Each line starts with exactly one marker:',
  '"→ " the one next action the reader must take (a command, a file, a decision to make);',
  '"✓ " what got done or what is now true, concrete (numbers, names, versions);',
  '"⚑ " a risk, blocker, failure or question that needs the reader.',
  'Skip a marker that does not apply. Never invent anything the reply does not say.',
  'Each line under 90 characters. Plain text, no markdown, no quotes.',
].join('\n')

export function words(text) {
  const t = String(text ?? '').trim()
  return t ? t.split(/\s+/).length : 0
}

// Brief this answer? `mode` all: any long main answer · agt: only a turn an /agt run
// was part of · off: never.
export function shouldBrief({ answer, mode, agtTurn }) {
  if (mode === 'off') return false
  if (mode !== 'all' && !agtTurn) return false
  return words(answer) >= BRIEF_MIN_WORDS
}

// Long answers keep head and tail: the opening states the result, the end the next step.
export function briefPrompt(answer) {
  const t = String(answer ?? '')
  const body = t.length <= MAX_INPUT ? t : t.slice(0, MAX_INPUT * 0.6) + '\n[…]\n' + t.slice(-MAX_INPUT * 0.4)
  return 'The reply:\n\n' + body
}

const KIND = { '→': 'next', '✓': 'done', '⚑': 'flag' }

function clip(s) {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length > MAX_LINE ? t.slice(0, MAX_LINE - 1) + '…' : t
}

// Model text → [{ kind, text }], next first, at most three; anything off-format is dropped.
export function parseBrief(text) {
  const out = []
  for (const raw of String(text ?? '').split('\n')) {
    const line = raw.replace(/^[\s>*•-]+/, '')
    const kind = KIND[line[0]]
    const rest = line.slice(1).replace(/^\uFE0F/, '').trim()
    if (kind && rest) out.push({ kind, text: clip(rest) })
  }
  const order = { next: 0, flag: 1, done: 2 }
  return out.sort((a, b) => order[a.kind] - order[b.kind]).slice(0, 3)
}

// One agent's final answer → a flag line, or null. Reviewers share `VERDICT: PASS|CONCERNS|FAIL`;
// the executor's VERIFICATION block carries real exit codes and counts.
export function flagOf(role, answer) {
  const a = String(answer ?? '')
  // The first verdict word decides, as routing.js verdictOf reads it: "APPROVE — nothing warrants a REVISE" is an approval.
  if (role === 'plan-reviewer' && /\b(APPROVE|REVISE)\b/.exec(a)?.[1] === 'REVISE') return role + ' asked for a revised plan'
  const v = /VERDICT:\s*(FAIL|CONCERNS)\b/.exec(a)
  if (v && role.endsWith('reviewer')) return role + ': ' + v[1] + (v[1] === 'FAIL' ? ' — blocks ship' : ' — fix before ship')
  if (role === 'adversary') {
    const b = /\bBROKEN:\s*([1-9]\d*)/.exec(a)
    if (b) return 'adversary broke ' + b[1] + ' case' + (b[1] === '1' ? '' : 's')
  }
  if (role === 'executor') {
    const ver = (/VERIFICATION:([\s\S]*?)(\n[A-Z]+:|$)/.exec(a) ?? [])[1] ?? ''
    if (/exit(?:\s*code)?\s*[:=]?\s*[1-9]\d*/i.test(ver) || /\b[1-9]\d* (failed|failing|fail|errors?)\b/i.test(ver)) return 'executor: verification failed'
    if (/did not run|not run|couldn'?t run|could not run/i.test(ver)) return 'executor: verification not run'
    if (/^CONTEXT\s/m.test(a)) return 'executor handed off at its context limit'
  }
  return null
}

// Panes that wait on a person: herdr reports `blocked` when an approval is on screen.
export function paneFlags(panes) {
  return (panes ?? []).filter((p) => p.state === 'blocked').map((p) => p.name + ' is waiting on you')
}

// /agt-focus arguments → { mode } | { show: true } | { error }
export function parseFocusArgs(args) {
  const a = String(args ?? '').trim().toLowerCase()
  if (!a) return { show: true }
  return FOCUS_MODES.includes(a) ? { mode: a } : { error: 'Usage: /agt-focus [all|agt|off]' }
}

export function focusText(mode, brief, flags) {
  const head = 'focus: ' + mode + (mode === 'all' ? ' (every long answer)' : mode === 'agt' ? ' (answers of /agt runs)' : ' (no briefs; agent flags still show)')
  const lines = [...flags.map((f) => '⚑ ' + f), ...brief.map((b) => ({ next: '→ ', done: '✓ ', flag: '⚑ ' })[b.kind] + b.text)]
  return lines.length ? head + '\n' + lines.join('\n') : head + '\nNothing to flag right now.'
}
