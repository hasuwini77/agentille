// Version skew: a session keeps running the agentille it started with, so a plugin update
// leaves it on old code (no wire, an old reaper). The plugin cache keeps one directory per
// installed version beside the running one: <cache>/<marketplace>/agentille/<x.y.z>. Pure.

const VERSION_RE = /^(\d+)\.(\d+)\.(\d+)$/

export function parseVersion(v) {
  const m = VERSION_RE.exec(String(v ?? '').trim())
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
}

// > 0 when a is newer than b; null when either is not x.y.z.
export function compareVersions(a, b) {
  const x = parseVersion(a)
  const y = parseVersion(b)
  if (!x || !y) return null
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i]
  return 0
}

// The newest x.y.z among the directory names beside the running plugin, when newer than `running`.
export function newerInstalled(running, names) {
  let best = null
  for (const n of names ?? []) if (compareVersions(n, running) > 0 && (best === null || compareVersions(n, best) > 0)) best = n
  return best
}

// The directory holding the running plugin's version directories, from its own root.
export function cacheDirOf(root) {
  const s = String(root ?? '').replace(/\/+$/, '')
  const at = s.lastIndexOf('/')
  return at > 0 ? s.slice(0, at) : null
}

export const skewMessage = (installed, running) => 'agentille v' + installed + ' is installed but this session runs v' + running + ' — restart Claude Code before opening panes'

// The oldest Claude Code the mod needs: the README's Requirements row carries the same number
// (tests/hooks/test-min-version.sh keeps them equal). Below it the mod still draws and routes, but
// its pane tools stay off: /agt runs its heavy level as subagent waves.
export const MIN_HOST = '2.1.294'

// The x.y.z Claude Code reported through $.session.version() (a string, or an object with a `version`
// field), or null when the call failed or the shape is unknown. Unknown is never "too old".
export function hostVersionOf(v) {
  const s = typeof v === 'string' ? v : v?.version
  return parseVersion(s) ? String(s).trim() : null
}

export const hostTooOld = (v) => compareVersions(v, MIN_HOST) < 0

export const hostMessage = (v) => 'Claude Code v' + v + ' is older than the v' + MIN_HOST + ' agentille needs — pane tools stay off until you update it'
