// agentille text: the long strings the mod hands the model (pane tool descriptions, the /agt prompt's pane block,
// the sessions notes), wrapped here so they read as prose. Each joins its pieces with one space, so the text the
// model sees is one line, as before. A leaf: it imports nothing, so panes.js can build its tools from it at load.

const line = (...parts) => parts.join(' ')

export const SPAWN_TOOL_TEXT = line(
  'Open one agentille worker pane beside this session (Herdr or tmux, whichever is live), never focused, named',
  'agt-<run>-<role>, running Claude on the model and effort agentille routes for `agent`, with the task as its first',
  'prompt. Use it for each heavy-level slice in place of raw herdr/tmux commands. The pane closes itself once it is',
  'done and its answer is saved; close it yourself with close_pane right after harvesting.',
)

export const CLOSE_TOOL_TEXT = line(
  'Close one agentille worker pane this session opened (an agt-<run>-<role> pane in this tab or window) after you',
  'have read its result, or a session it opened with open_sessions (s-<run>-<n>) when the person asks. Panes opened',
  'by a typed /agt-spawn (the reaper closes those) and panes of other sessions are refused.',
)

// `idleMin`: how long a resting Herdr session waits before it is closed (panes.js SESSION_IDLE_MS, in minutes).
export const sessionsToolText = (idleMin) => line(
  'Open interactive sessions beside this one as Herdr or tmux panes, never focused: Claude by default, or Codex or a',
  'plain shell. Use it whenever the person asks to open or start sessions, panes, terminals, Claudes or Codexes',
  '("open three sessions"): that is a direct action, not orchestration, so never answer it with subagents. Each',
  'session belongs to the person, like one opened by hand: no worker and no reports. On Herdr a Claude or Codex',
  'session is closed after ' + idleMin + ' minutes idle and unfocused, and at session end when idle; a shell, or any',
  'session on tmux, closes only on request. Not for delegating work.',
)

export const sessionsNoteText = (idleMin) => ' ' + line(
  'Each is closed after ' + idleMin + ' minutes idle and unfocused, and at session end when idle. When the person',
  'asks you to send one a prompt: herdr agent prompt <name> "…". To read it: herdr agent read <name> --source',
  'recent-unwrapped --lines 120.',
  'close_pane <name> closes one now when the person asks.',
)

export const SESSIONS_ON_REQUEST = ' They close only on request: close_pane <name> when the person asks.'

export const PANE_RULE = line(
  'Pane rule: panes open only on the heavy level (auto-picked or typed `/agt heavy`): each slice\'s executor (and the',
  'adversary) via spawn_pane (agent + header); everyone else is a subagent. close_pane right after harvest.',
)

export const NO_TRANSPORT = 'No pane transport here: parallel slices run as a workflow, else subagent waves.'
