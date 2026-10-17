// /agt flag autocomplete: rows for the token at the cursor while a typed /agt prompt is being written.

// Mirror of skills/agt/SKILL.md: the one optional level word right after /agt, and the one flag left.
export const AGT_LEVELS = [
  { text: 'low', description: 'one stream, may run solo' },
  { text: 'medium', description: '2-3 small streams as subagents' },
  { text: 'heavy', description: 'worker panes in Herdr or tmux' },
  { text: 'next', description: 'build the next item of .agentille/backlog.md' },
]
export const AGT_FLAGS = [{ text: '--fable', description: 'Fable ceiling on judgment roles' }]

const CMD = /^\/(agentille:)?agt$/

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

// Rows for the token, or [] when the token is the command itself or nothing matches. The first word
// after /agt completes to the levels; a dash completes to the flag. The draft is known to be a typed
// /agt one: registerAutocomplete's matcher lets nothing else through.
export function agtSuggestions({ text, token, start }) {
  if (typeof token !== 'string' || !(start > 0)) return []
  const match = (rows) => rows.filter((r) => r.text.startsWith(token) && r.text !== token)
  if (token === '-' || token.startsWith('--')) return match(AGT_FLAGS)
  return CMD.test(wordBefore(text, start)) ? match(AGT_LEVELS) : []
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
