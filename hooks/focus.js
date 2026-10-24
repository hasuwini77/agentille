// agentille focus — what in a run needs the reader. Pure on purpose: register.js draws.
//
// Flags are read straight off agent results (a REVISE, a FAIL verdict, a failed check, a
// blocked pane). No model call.

import { verdictOf } from './routing.js'

export function words(text) {
  const t = String(text ?? '').trim()
  return t ? t.split(/\s+/).length : 0
}

const EXPECTED_EXIT = /found nothing|nothing found|no match(?:es)?|as expected|\(expected\)|expected (?:exit|non-?zero)/i

// One agent's final answer → a flag line, or null. Reviewers share `VERDICT: PASS|CONCERNS|FAIL`;
// the executor's VERIFICATION block carries real exit codes and counts.
export function flagOf(role, answer) {
  const a = String(answer ?? '')
  if (role === 'plan-reviewer' && verdictOf(a) === 'REVISE') return role + ' asked for a revised plan'
  const v = /VERDICT:\s*(FAIL|CONCERNS)\b/.exec(a)
  if (v && role.endsWith('reviewer')) return role + ': ' + v[1] + (v[1] === 'FAIL' ? ' — blocks ship' : ' — fix before ship')
  if (role === 'adversary') {
    const b = /\bBROKEN:\s*([1-9]\d*)/.exec(a)
    if (b) return 'adversary broke ' + b[1] + ' case' + (b[1] === '1' ? '' : 's')
  }
  if (role === 'executor') {
    const ver = (/VERIFICATION:([\s\S]*?)(\n[A-Z]+:|$)/.exec(a) ?? [])[1] ?? ''
    // Each line on its own: a non-zero exit the line calls the expected result (grep's "no match" is exit 1) is a pass.
    const failed = ver.split('\n').some((l) => (/exit(?:\s*code)?\s*[:=]?\s*[1-9]\d*/i.test(l) && !EXPECTED_EXIT.test(l)) || /\b[1-9]\d* (failed|failing|fail|errors?)\b/i.test(l))
    if (failed) return 'executor: verification failed'
    if (/did not run|not run|couldn'?t run|could not run/i.test(ver)) return 'executor: verification not run'
    if (/^CONTEXT\s/m.test(a)) return 'executor handed off at its context limit'
  }
  return null
}

// The key a routed answer's flag lives under. Planning is one conversation: the planner and the
// plan-reviewer share a key, so a re-plan clears "asked for a revised plan" even when the lead
// goes on without a third review. Everything else is keyed by role and slice.
export function flagKey(role, slice) {
  const r = role === 'planner' || role === 'plan-reviewer' ? 'plan' : role
  return r + '|' + (slice ?? '')
}

// A routed answer replaces the flag its agent left earlier (key = flagKey): a PASS after a
// CONCERNS clears it, and a slice's reviewer never clears another slice's. Flags past `ttl` fall off.
export function mergeFlags(flags, key, text, now, ttl) {
  const kept = (flags ?? []).filter((f) => now - f.at < ttl && f.key !== key)
  return text ? [...kept, { text, key, at: now }] : kept
}

// Panes that wait on a person: herdr reports `blocked` when an approval is on screen. Panes whose
// answer nobody has taken (`stranded`, a set of names) are kept open, so they say so.
export function paneFlags(panes, stranded = new Set()) {
  const list = panes ?? []
  return [
    ...list.filter((p) => p.state === 'blocked').map((p) => p.name + ' is waiting on you'),
    ...list.filter((p) => stranded.has(p.name)).map((p) => p.name + (p.state === 'idle' ? ' idle' : ' done') + ', not harvested'),
  ]
}

// /agt-focus arguments → { on } | { show: true } | { error }
export function parseFocusArgs(args) {
  const a = String(args ?? '').trim().toLowerCase()
  if (!a) return { show: true }
  return a === 'on' || a === 'off' ? { on: a === 'on' } : { error: 'Usage: /agt-focus [on|off]' }
}

export function focusText(on, flags) {
  const head = 'focus: ' + (on ? 'on (agent flags show above the prompt)' : 'off (no flags above the prompt)')
  return flags.length ? head + '\n' + flags.map((f) => '⚑ ' + f).join('\n') : head + '\nNothing to flag right now.'
}
