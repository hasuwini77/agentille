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

// existing: Set of squad signal paths that exist in the repo
export function activeSquads(config, deps, existing) {
  const out = []
  for (const s of config?.squads ?? []) {
    const matched = [
      ...(s.signals?.deps ?? []).filter((d) => deps.has(d)),
      ...(s.signals?.paths ?? []).filter((p) => existing.has(p)),
    ]
    if (matched.length >= (s.minScore ?? 2)) out.push({ name: s.name, label: s.label, matched, adds: s.adds ?? [], checklists: s.checklists ?? {} })
  }
  return out
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
