// /agt flag autocomplete: rows for the token at the cursor while a typed /agt prompt is being written.
import { isAgtPrompt } from './live.js'

// Mirror of skills/agt/SKILL.md argument-hint + "Run modifiers". Keep in step with both.
export const AGT_FLAGS = [
  { text: '--plan', description: 'stop after the plan and its review' },
  { text: '--mode', description: 'force a mode: panes | subagent | solo' },
  { text: '--fable', description: 'Fable ceiling on judgment roles' },
  { text: '--formation', description: 'force a formation: duel | gauntlet | relay' },
]

// Rows for the token, or [] when this is not a /agt prompt, the token is the command itself, or nothing matches.
export function agtSuggestions({ text, token, start }) {
  if (typeof token !== 'string' || !token.startsWith('--') && token !== '-') return []
  if (!isAgtPrompt(text) || !(start > 0)) return []
  return AGT_FLAGS.filter((f) => f.text.startsWith(token) && f.text !== token)
}

// Fires on every keystroke: answer next(e) at once when there is nothing to add.
export async function autocompleteHook($, e, next) {
  const rows = agtSuggestions(e)
  if (!rows.length) return next(e)
  const r = await next(e)
  return { suggestions: [...(r?.suggestions ?? []), ...rows] }
}

export function registerAutocomplete(on, _ctx) {
  on('prompt.autocomplete', { token: /^-/ }, autocompleteHook)
}
