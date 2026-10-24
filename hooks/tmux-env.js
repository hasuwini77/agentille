// tmux reads its client's locale to decide whether its output may carry a tab. With no UTF-8 in LC_ALL, LC_CTYPE or
// LANG (a launchd job, `env -i`, a bare CI shell) it prints `_` in place of every tab, and a `list-panes -F` line
// whose fields are joined on a tab no longer splits. Every tmux call the mod runs gets LC_ALL=C.UTF-8 on top of the
// host's own env (the host merges init.env into it), so the listing parses whatever locale the session started in.
// A leaf: it imports nothing, so any module can use it without joining the import cycle.

export const TMUX_LOCALE = Object.freeze({ LC_ALL: 'C.UTF-8' })

// The run options for `argv`: a tmux argv gets the locale added to `init.env`; any other argv gets `init` unchanged.
export function tmuxInit(argv, init) {
  if (!Array.isArray(argv) || argv[0] !== 'tmux') return init
  return { ...init, env: { ...init?.env, ...TMUX_LOCALE } }
}
