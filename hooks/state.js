// agentille mod state: one record, read and written by register.js and the modules it wires. Everything
// here lives for the session (a reload starts it over); nothing is persisted from here but through $.store
// and the run files. Fields that are reassigned are read as S.name; the collections are destructured once.

import { DEFAULTS } from './routing.js'
import { resolveDisplay } from './settings.js'

export const S = {
  settings: { ...DEFAULTS },
  depth: null,
  profileMissing: false,  // no profile with a voice (missing, unreadable, or only a display block): the tip is due once
  home: null,
  weeklyPct: null,
  lastRun: 'adhoc',
  wfToasted: new Set(),  // run:role pairs whose drift the person was told once
  runs: new Map(),  // run id → { revise, fixes, fable, formation, log: [], reports: { role → count } }
  live: new Map(),  // agentId → live agent (live.js)
  decisions: [],  // this session, for /agt-info routing
  panes: [],  // agt-* panes (herdr or tmux) other than this one
  paneRoutes: [],  // PaneRoute[], append-only: how each worker this lead opened was routed
  opened: [],  // { id, name } of panes this lead opened via spawn_pane, in spawn order
  openedNames: new Set(),  // every pane name this lead opened, kept after the pane closes
  sessions: [],  // { id, name, kind, tab, terminal } of the sessions this lead opened via open_sessions, oldest first
  restingSince: new Map(),  // session name → when it was first seen idle and unfocused (sessionSweep)
  staged: new Map(),  // pane name → last pane seen on stage (live.js panesLeft)
  paneSeen: new Map(),  // reaper bookkeeping
  harvested: new Set(),  // pane ids whose answer the lead has in hand (a wire done message, a saved answer file, a close_pane)
  wireDone: new Set(),  // pane ids whose wire done message reached this lead
  woken: new Set(),  // pane ids the lead already woke itself for
  strandedNow: new Set(),  // done/idle panes kept open because nothing was harvested from them
  strandedToasted: new Set(),  // ... pane ids of which the person was told once
  firstSeen: new Map(),  // pane id → when this session first listed it: a done-file or answer file older than that is a previous pane's
  selfName: null,  // this pane's name when it is an agt-* worker
  worker: null,  // { agent, model, effort } from AGENTILLE_WORKER: this session is a worker pane
  selfTab: null,  // herdr: the lead's own tab, where its workers split
  selfWorkspace: null,  // herdr: the lead's workspace, where a run tab opens
  ownedTabs: new Set(),  // herdr: run tabs this session created; its panes are reaped, closed and swept like the lead's tab's
  paneTools: false,  // spawn_pane (and close_pane) registered: a typed /agt arrived in this lead session
  sessionTools: false,  // open_sessions (and close_pane) registered: a typed ask for sessions arrived
  closeTool: false,  // close_pane registered, by whichever of the two came first
  squads: [],  // active squads for this repo
  squadBlock: '',
  squadRows: [],  // every squad scored, for /agt-info squads; null when squads.json is unreadable
  transport: null,  // 'herdr' | 'tmux' | 'none', probed once at session start
  tick: 0,
  pollTimer: null,  // pane polling: runs only while panes may exist
  quietPolls: 0,
  tickTimer: null,  // redraw ticker: runs only while something works
  focusOn: true,  // agent flags show above the prompt
  flags: [],  // [{ text, key, at }] from agent results this run
  agtTurn: false,  // this turn is part of an /agt run
  worktrees: [],  // { path, branch, head, run, at } of the worktrees this session's runs made (guard.js), saved to lead-<pane>.worktrees
  agtTyped: false,  // the person typed /agt and its run is not over (routing.js runInFlight): only then may the lead open worker panes
  fableTyped: false,  // ... and typed --fable on it: only then does a header's fable=forced hold
  agtTypedSince: 0,  // typed prompts other than /agt since the newest typed /agt (the run's grace, AGT_GRACE_TYPED)
  sessionsAsked: false,  // this turn's prompt was typed and asked for sessions of the person's own (open_sessions)
  lastTyped: '',  // the newest typed prompt: a shell session runs only a command it asks for
  agtPrompt: '',  // the newest typed /agt prompt: a worker pane runs on Codex only when it or lastTyped names Codex
  workerProved: false,  // worker: its first typed prompt decided whether fable=forced holds here
  demotedToasted: new Set(),  // run ids told once that fable=forced was dropped for want of a typed --fable
  leadTurn: false,  // a main-loop turn is running: its idle panes are waiting for review
  mascot: { greeted: false, hiUntil: 0, byeUntil: 0, working: false, start: 0, ms: null },  // worker band, in $.clock.now() ms
  highlightOn: false,  // /agt replies get an essentials card and lit tokens (display.highlight: on | all)
  highlightAll: false,  // …and so does every other long reply (/agt-highlight all)
  litMemo: new Map(),  // message id → was it an /agt turn when first drawn
  hlMemo: new Map(),  // message id → { text, highlight() result }
  panelMemo: new Map(),  // message id → { text, panel() result }: the blocks that closed a main turn's answer
  lastAnswer: null,  // { text, ms, id, shaped } of the newest main-turn answer; its closing block draws as the panel
  shapedTurn: false,  // this turn's prompt carried the answer style (display.highlight: all)
  rawTurn: false,  // this turn's prompt asked for text to paste as is: no panel, answer copied
  rawIds: new Set(),  // message ids that closed a raw answer: they draw as the engine does
  runningVersion: null,  // this module's own agentille version, read from its plugin.json at session start
  hostVersion: null,  // Claude Code's version from $.session.version(), null when unknown
  hostOld: false,  // the host is older than skew.js MIN_HOST: pane tools are never registered
  skewToasted: false,
  sessionId: null,  // this session's id: workers it opens send their results here
  leadModel: null,  // the main loop's model, for the tree's root
  wireLog: [],  // [{ from, to, kind, summary, at }] messages between sessions, newest last
  wireStatus: new Map(),  // pane name → what its worker last published (wire.js workerStatus)
  wireName: null,  // worker: its own agt- name (AGENTILLE_NAME), where it publishes
  leadSession: null,  // worker: the lead's session id (AGENTILLE_LEAD), where it reports
  pub: { state: 'starting', tool: null, tok: 0, model: null, effort: null, start: null, at: 0 },  // worker's published status
  lastMeta: '',  // worker: the last Herdr sidebar title it reported
  deckAuto: false,  // display.deck = auto: the deck opens on every typed /agt
  profileDisplay: {},  // the valid keys of ~/.agentille/profile.json → display
  storedRaw: {},  // the old $.store toggles, read once at session start (back-compat)
  display: resolveDisplay({}, {}),  // the display settings in effect, and where each came from
  listAt: 0,
  listBusy: false,
}

// What the modules wired last in register(on) read: live state through getters, since most of
// it is reassigned.
export const ctx = {
  live: S.live,
  get run() { return S.lastRun },
  get tick() { return S.tick },
  get panes() { return S.panes },
  get routes() { return S.paneRoutes },
  get isLead() { return !S.worker && !S.selfName },
  onTick: [], // (io, ctx, now) callbacks the redraw ticker calls each period; a module adds its own while registering
}
