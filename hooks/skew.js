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
