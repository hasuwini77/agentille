// agentille focus — what in a run needs the reader. Pure on purpose: register.js draws.
//
// Flags are read straight off agent results (a REVISE, a FAIL verdict, a failed check, a
// blocked pane). No model call.

export function words(text) {
  const t = String(text ?? '').trim()
  return t ? t.split(/\s+/).length : 0
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
