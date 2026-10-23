// agentille session load: the profile and its voice, the squads of this repo, the installed-version skew and
// the one-time tip. Read at session start; the squads again on /agt-info.

import { S } from './state.js'
import { TIP } from './drawing.js'
import { DEFAULTS } from './routing.js'
import { cleanDisplay, hasVoice } from './settings.js'
import { compareVersions, newerInstalled, cacheDirOf } from './skew.js'
import { depsOf, activeSquads, explain, squadsText, allPaths, injection } from './squads.js'

// The newer agentille version installed beside the one this session runs, or null: nothing found,
// nothing readable (a checkout, a host without a plugin cache) all read as no skew. A replaced version
// stays in the cache with an .orphaned_at marker; it is not installed, so only a newer folder without
// one counts (one lookup per newer folder).
export async function installedSkew($) {
  if (!S.runningVersion) return null
  try {
    const dir = cacheDirOf($.plugin.root)
    if (!dir) return null
    const newer = []
    for (const e of await $.fs.list(dir)) {
      if (e.kind === 'dir' && compareVersions(e.name, S.runningVersion) > 0 && !(await $.fs.exists(dir + '/' + e.name + '/.orphaned_at'))) newer.push(e.name)
    }
    return newerInstalled(S.runningVersion, newer)
  } catch {
    return null
  }
}

export async function loadProfile($) {
  S.home = (await $.env.get('HOME')) ?? null
  S.profileDisplay = {}
  S.profileMissing = false
  if (!S.home) return
  try {
    const p = JSON.parse(await $.fs.read(S.home + '/.agentille/profile.json'))
    // a toggle can create a profile that holds only display: that is still a profile with no voice
    S.profileMissing = !hasVoice(p)
    S.depth = p.thinkingDepth ?? null
    S.settings = { ...DEFAULTS, ...(p.routing ?? {}) }
    S.profileDisplay = cleanDisplay(p.display)
  } catch {
    // no profile yet: the tip says /agentille-init (the mod's toast when it draws, else /agt's line)
    S.profileMissing = true
  }
}

export async function loadSquads($) {
  try {
    const config = JSON.parse(await $.fs.read($.plugin.root + '/.claude-plugin/squads.json'))
    const cwd = await $.session.cwd()
    let pkg = ''
    try { pkg = await $.fs.read(cwd + '/package.json') } catch { /* not a node repo */ }
    const existing = new Set()
    for (const p of allPaths(config)) if (await $.fs.exists(cwd + '/' + p)) existing.add(p)
    const deps = depsOf(pkg)
    S.squads = activeSquads(config, deps, existing)
    S.squadRows = explain(config, deps, existing)
    S.squadBlock = injection(S.squads)
  } catch {
    S.squads = []
    S.squadRows = null
    S.squadBlock = ''
  }
}

export async function squadsView($) {
  await loadSquads($)
  return squadsText(S.squadRows)
}

// The profile tip, once per machine: the same marker /agt writes when it prints the tip itself.
export async function tipOnce($) {
  if (!S.profileMissing || !S.home) return
  const marker = S.home + '/.agentille/state/.tip-shown'
  if (await $.fs.exists(marker).catch(() => true)) return
  $.ui.toast(TIP, { timeoutMs: 8000 })
  await $.fs.write(marker, '').catch(() => {})
}
