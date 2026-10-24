// agentille session load: the profile and its voice, the squads of this repo, the installed-version skew and
// the one-time tip. Read at session start; the squads again on /agt-info.

import { S } from './state.js'
import { makeStore } from './store.js'
import { TIP } from './drawing.js'
import { DEFAULTS } from './routing.js'
import { cleanDisplay, hasVoice } from './settings.js'
import { setProfileDisplay } from './display.js'
import { compareVersions, newerInstalled, cacheDirOf } from './skew.js'
import { depsOf, activeSquads, explain, squadsText, allPaths, injection } from './squads.js'

// The profile's store: what the session read from ~/.agentille/profile.json and squads.json. Read through the Profile
// view; written only by loadProfile and loadSquads.
const { s: my, view } = makeStore('profile.js', {
  home: null,
  settings: { ...DEFAULTS },
  depth: null,
  profileMissing: false,  // no profile with a voice (missing, unreadable, or only a display block): the tip is due once
  squads: [],  // active squads for this repo
  squadBlock: '',
  squadRows: [],  // every squad scored, for /agt-info squads; null when squads.json is unreadable
})
export const Profile = view

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
  my.home = (await $.env.get('HOME')) ?? null
  setProfileDisplay({})
  my.profileMissing = false
  if (!my.home) return
  try {
    const p = JSON.parse(await $.fs.read(my.home + '/.agentille/profile.json'))
    // a toggle can create a profile that holds only display: that is still a profile with no voice
    my.profileMissing = !hasVoice(p)
    my.depth = p.thinkingDepth ?? null
    my.settings = { ...DEFAULTS, ...(p.routing ?? {}) }
    setProfileDisplay(cleanDisplay(p.display))
  } catch {
    // no profile yet: the tip says /agentille-init (the mod's toast when it draws, else /agt's line)
    my.profileMissing = true
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
    my.squads = activeSquads(config, deps, existing)
    my.squadRows = explain(config, deps, existing)
    my.squadBlock = injection(my.squads)
  } catch {
    my.squads = []
    my.squadRows = null
    my.squadBlock = ''
  }
}

export async function squadsView($) {
  await loadSquads($)
  return squadsText(my.squadRows)
}

// The profile tip, once per machine: the same marker /agt writes when it prints the tip itself.
export async function tipOnce($) {
  if (!my.profileMissing || !my.home) return
  const marker = my.home + '/.agentille/state/.tip-shown'
  if (await $.fs.exists(marker).catch(() => true)) return
  $.ui.toast(TIP, { timeoutMs: 8000 })
  await $.fs.write(marker, '').catch(() => {})
}
