// agentille mod — what /agt can leave to the mod when the mod draws: the version and the phases
// on the band, the one-time tip, and the Agents and Raw reports sections of report.md.
// Pure: register.js reads the surfaces and the files, this decides and formats.

import { elapsed, short, tokens } from './live.js'

// Surfaces that show a mod's band. The VS Code chat panel, `claude -p` and the SDK run hooks but draw nothing.
const DRAWN = new Set(['terminal', 'desktop'])

export const TIP = 'tip: /agentille-init makes agents sound like you'

export function canDraw(surfaces) {
  return (surfaces ?? []).some((s) => DRAWN.has(s))
}

// The marker the skill looks for (display.md → "When the mod draws"). Absent: the skill prints it all itself.
export function drawingBlock(draws) {
  if (!draws) return ''
  return '\n## Drawing (agentille mod)\n\nmod draws: yes. The band shows the version and the phases, the mod shows the tip and adds Agents and Raw reports to report.md.\n'
}

// `…/.agentille/state/run-<id>/report.md` → the run id, else null.
export function reportRun(path) {
  const m = /\/\.agentille\/state\/run-([A-Za-z0-9_-]{1,64})\/report\.md$/.exec(String(path ?? ''))
  return m ? m[1] : null
}

// The sections the mod owns, for whichever of them the report still lacks. '' when it has both.
export function reportTail(text, { agents = [], routes = [], files = [] }) {
  const out = []
  if (!/^## Agents\b/m.test(text)) {
    const rows = [...agents].sort((a, b) => a.start - b.start).map((a) =>
      '| ' + a.role + ' | ' + short(a.model) + (a.effort ? ' · ' + a.effort : '') + ' | ' + elapsed((a.end ?? a.start) - a.start) + ' | ' + tokens(a.input) + ' / ' + tokens(a.output) + ' |')
    for (const r of routes) rows.push('| ' + (r.agent ?? r.role) + ' (pane) | ' + short(r.model) + (r.effort ? ' · ' + r.effort : '') + ' | ' + elapsed((r.end ?? r.start) - r.start) + ' | n/a |')
    if (rows.length) out.push('## Agents', '', '| role | model · effort | elapsed | tokens in / out |', '|---|---|---|---|', ...rows, '')
  }
  if (!/^## Raw reports\b/m.test(text) && files.length) {
    out.push('## Raw reports', '', ...[...files].sort().map((f) => '- [' + f + '](agents/' + f + ')'), '')
  }
  if (!out.length) return ''
  return (text.endsWith('\n') ? '\n' : '\n\n') + out.join('\n')
}
