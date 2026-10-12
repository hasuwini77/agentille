// Squad detection: score .claude-plugin/squads.json against the repo's deps + paths.
// Pure; register.js reads the files and injects the result into the /agt skill text.

export function depsOf(pkgText) {
  try {
    const p = JSON.parse(pkgText)
    return new Set([...Object.keys(p.dependencies ?? {}), ...Object.keys(p.devDependencies ?? {})])
  } catch {
    return new Set()
  }
}

// One squad's signals split into found and not found. existing: Set of signal paths that exist in the repo.
function scored(s, deps, existing) {
  const matched = []
  const missing = []
  for (const d of s.signals?.deps ?? []) (deps.has(d) ? matched : missing).push(d)
  for (const p of s.signals?.paths ?? []) (existing.has(p) ? matched : missing).push(p)
  return { matched, missing, minScore: s.minScore ?? 2 }
}

export function activeSquads(config, deps, existing) {
  const out = []
  for (const s of config?.squads ?? []) {
    const { matched, minScore } = scored(s, deps, existing)
    if (matched.length >= minScore) out.push({ name: s.name, label: s.label, matched, adds: s.adds ?? [], checklists: s.checklists ?? {} })
  }
  return out
}

// Every squad with its score, for /agt-squads. A near-miss is inactive with score > 0.
export function explain(config, deps, existing) {
  return (config?.squads ?? []).map((s) => {
    const { matched, missing, minScore } = scored(s, deps, existing)
    return { name: s.name, label: s.label, score: matched.length, minScore, matched, missing, adds: s.adds ?? [], active: matched.length >= minScore }
  })
}

const MISSING_SHOWN = 5

function rowText(r) {
  const gone = r.missing.length > MISSING_SHOWN ? r.missing.slice(0, MISSING_SHOWN).join(', ') + ', +' + (r.missing.length - MISSING_SHOWN) + ' more' : r.missing.join(', ')
  return [
    '- ' + r.name + ' (' + r.label + ') ' + r.score + '/' + r.minScore,
    '  found: ' + (r.matched.join(', ') || 'none'),
    '  missing: ' + (gone || 'none'),
    '  adds: ' + (r.adds.join(', ') || 'none'),
  ].join('\n')
}

export function squadsText(rows) {
  if (rows === null) return 'squads.json is unreadable: squad detection is off until it parses again.'
  const active = rows.filter((r) => r.active)
  const near = rows.filter((r) => !r.active && r.score > 0)
  if (active.length === 0 && near.length === 0) return 'No squads detected: no squad signal (package.json dep or repo path) matches this repo.'
  const out = []
  if (active.length) out.push('Active squads', ...active.map(rowText))
  if (near.length) out.push('Near misses (score below minimum)', ...near.map(rowText))
  return out.join('\n')
}

export function allPaths(config) {
  return [...new Set((config?.squads ?? []).flatMap((s) => s.signals?.paths ?? []))]
}

export function injection(active) {
  if (active.length === 0) return ''
  const adds = [...new Set(active.flatMap((s) => s.adds))]
  const roles = {}
  for (const s of active) {
    for (const [role, lines] of Object.entries(s.checklists)) {
      roles[role] ??= new Set()
      for (const l of lines) roles[role].add(l)
    }
  }
  const out = ['', '## Squads detected by the agentille mod', '']
  for (const s of active) out.push('- **' + s.name + '** (' + s.label + ') — signals: ' + s.matched.join(', '))
  out.push('', 'Add specialists (see `squads.md`): ' + adds.map((r) => '`agentille:agentille-' + r + '`').join(', '), '')
  for (const [role, lines] of Object.entries(roles)) {
    out.push('Squad checklist for **' + role + '**:')
    for (const l of lines) out.push('- ' + l)
  }
  return out.join('\n') + '\n'
}
