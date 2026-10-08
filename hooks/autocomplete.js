// /agt flag autocomplete: rows for the token at the cursor while a typed /agt prompt is being written.

// Mirror of skills/agt/SKILL.md argument-hint (flags and their values) + "Run modifiers". Keep in step with both.
export const AGT_FLAGS = [
  { text: '--plan', description: 'stop after the plan and its review' },
  { text: '--mode', description: 'force a mode: panes | subagent | solo' },
  { text: '--fable', description: 'Fable ceiling on judgment roles' },
  { text: '--formation', description: 'force a formation: duel | gauntlet | relay' },
]

// The values a flag takes (SKILL.md "Modes" and "Run modifiers"). `herdr` is a legacy alias of panes: not offered.
export const AGT_VALUES = {
  '--mode': [
    { text: 'panes', description: 'one pane per disjoint slice' },
    { text: 'subagent', description: 'no panes, agents run in-process' },
    { text: 'solo', description: 'the main session does it alone' },
  ],
  '--formation': [
    { text: 'duel', description: 'two approaches built apart, the better one wins' },
    { text: 'gauntlet', description: 'build, then an adversary tries to break it' },
    { text: 'relay', description: 'contract first, then the slices build in parallel' },
  ],
}

const WS = /\s/

// The whitespace-delimited word before `start`, found by scanning back from it: the cost is that word's
// length, not the draft's, and this runs on every keystroke.
function wordBefore(text, start) {
  const t = String(text)
  const space = (i) => WS.test(t[i])
  let end = Math.min(start, t.length)
  while (end > 0 && space(end - 1)) end--
  let at = end
  while (at > 0 && !space(at - 1)) at--
  return t.slice(at, end)
}

// Rows for the token, or [] when the token is the command itself or nothing matches. A flag token
// completes to flags; the word after a flag that takes a value completes to its values. The draft is
// known to be a typed /agt one: registerAutocomplete's matcher lets nothing else through.
export function agtSuggestions({ text, token, start }) {
  if (typeof token !== 'string' || !(start > 0)) return []
  const match = (rows) => rows.filter((r) => r.text.startsWith(token) && r.text !== token)
  if (token === '-' || token.startsWith('--')) return match(AGT_FLAGS)
  const flag = wordBefore(text, start)
  return Object.hasOwn(AGT_VALUES, flag) ? match(AGT_VALUES[flag]) : []
}

// Fires on every keystroke: answer next(e) at once when there is nothing to add.
export async function autocompleteHook($, e, next) {
  const rows = agtSuggestions(e)
  if (!rows.length) return next(e)
  const r = await next(e)
  return { suggestions: [...(r?.suggestions ?? []), ...rows] }
}

export function registerAutocomplete(on, _ctx) {
  on('prompt.autocomplete', { text: /^\s*\/(agentille:)?agt(\s|$)/ }, autocompleteHook)
}
