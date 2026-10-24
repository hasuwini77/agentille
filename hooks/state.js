// agentille mod state: one record, read and written by register.js and the modules it wires. Everything
// here lives for the session (a reload starts it over); nothing is persisted from here but through $.store
// and the run files. Fields that are reassigned are read as S.name; the collections are destructured once.
// What the lead keeps about each pane (harvest, wake, stranded, first seen, stage) is in panerec.js.

import { Timers } from './ticker.js'
import { Wire } from './worker.js'
import { Profile } from './profile.js'
import { Display } from './display.js'
import { Runs } from './dispatch.js'
import { Spawn } from './spawn.js'
import { Panes } from './reaper.js'
import { Sessions } from './sessions.js'

// The read views of the stores the owner modules keep (store.js): read through these, written only by their owners.
export { Timers, Wire, Profile, Display, Runs, Spawn, Panes, Sessions }

export const S = {
  weeklyPct: null,
  selfName: null,  // this pane's name when it is an agt-* worker
  worker: null,  // { agent, model, effort } from AGENTILLE_WORKER: this session is a worker pane
  selfTab: null,  // herdr: the lead's own tab, where its workers split
  selfWorkspace: null,  // herdr: the lead's workspace, where a run tab opens
  agtTurn: false,  // this turn is part of an /agt run (written only through proofs.js agtTurnStart / agtTurnFromDispatch)
  worktrees: [],  // { path, branch, head, run, at, src } of the worktrees this session's runs made (guard.js), saved to lead-<pane>.worktrees
  // The typed proofs: written only through proofs.js, read here and through ctx.
  agtTyped: false,  // the person typed /agt and its run is not over (routing.js runInFlight): only then may the lead open worker panes
  fableTyped: false,  // ... and typed --fable on it: only then does a header's fable=forced hold
  agtTypedAt: null,  // $.clock.now() of the newest typed /agt (null: unknown): its run is in flight AGT_INFLIGHT_MAX_MS at most
  agtBirth: false,  // this turn is the typed /agt's own: any run id may open a pane, and the first one is the run's
  agtRun: null,  // the run id the typed /agt named first (a pane or a routed dispatch): later turns open panes only for it, and the lead's Bash guard holds until its card
  agtTypedSince: 0,  // typed prompts other than /agt since the newest typed /agt (the run's grace, AGT_GRACE_TYPED)
  sessionsAsked: false,  // this turn's prompt was typed and asked for sessions of the person's own (open_sessions)
  lastTyped: '',  // the newest typed prompt: a shell session runs only a command it asks for
  agtPrompt: '',  // the newest typed /agt prompt: a worker pane runs on Codex only when it or lastTyped names Codex
  workerProved: false,  // worker: its first typed prompt decided whether fable=forced holds here
  leadTurn: false,  // a main-loop turn is running: its idle panes are waiting for review
  shapedTurn: false,  // this turn's prompt carried the answer style (display.highlight: all)
  rawTurn: false,  // this turn's prompt asked for text to paste as is: no panel, answer copied
  runningVersion: null,  // this module's own agentille version, read from its plugin.json at session start
  hostVersion: null,  // Claude Code's version from $.session.version(), null when unknown
  hostOld: false,  // the host is older than skew.js MIN_HOST: pane tools are never registered
  skewToasted: false,
  sessionId: null,  // this session's id: workers it opens send their results here
  leadModel: null,  // the main loop's model, for the tree's root
  wireName: null,  // worker: its own agt- name (AGENTILLE_NAME), where it publishes
  leadSession: null,  // worker: the lead's session id (AGENTILLE_LEAD), where it reports
}

// This session is the lead: no worker env and no agt- name of its own. The one lead/worker predicate.
export const isLead = () => !S.worker && !S.selfName

// What the modules wired last in register(on) read: live state through getters, since most of
// it is reassigned.
export const ctx = {
  get live() { return Runs.live },
  get run() { return Runs.lastRun },
  get tick() { return Timers.tick },
  get panes() { return Panes.panes },
  get routes() { return Runs.paneRoutes },
  get isLead() { return isLead() },
  onTick: [], // (io, ctx, now) callbacks the redraw ticker calls each period; a module adds its own while registering
}
