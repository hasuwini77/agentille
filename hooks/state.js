// agentille mod state: the index of the session's stores. Each piece of state lives in the module that writes it
// (store.js makeStore), and every other module reads it through that owner's read view, re-exported here:
//
//   Session   state.js     who this session is (lead or worker, its names, ids and versions), the lead's turn
//   Proofs    proofs.js    the typed proofs the gates trust
//   Runs      dispatch.js  the run the band follows, per-run counters, live agents, decisions, pane routes
//   Spawn     spawn.js     the pane transport, the panes and run tabs this lead opened, the pane tools registered
//   Panes     reaper.js    the agt-* panes the newest poll listed
//   Sessions  sessions.js  the person's own sessions this lead opened
//   Profile   profile.js   home, routing settings, depth and squads, from profile.json and squads.json
//   Display   display.js   the display settings and switches, flags, the newest answer, the worker band's mascot
//   Wire      worker.js    the wire log, each worker's published status, this worker's own
//   Timers    ticker.js    the redraw count
//   Worktrees guard.js     the worktrees this session's runs made
//
// A module writes only its own store, through its transitions: a view throws on assignment. Everything here lives
// for the session (a reload starts it over); nothing is persisted from here but through $.store and the run files.
// What the lead keeps about each pane (harvest, wake, stranded, first seen, stage) is in panerec.js.

import { makeStore } from './store.js'
import { Timers } from './ticker.js'
import { Wire } from './worker.js'
import { Profile } from './profile.js'
import { Display } from './display.js'
import { Runs } from './dispatch.js'
import { Spawn } from './spawn.js'
import { Panes } from './reaper.js'
import { Sessions } from './sessions.js'
import { Proofs } from './proofs.js'
import { Worktrees } from './guard.js'

export { Timers, Wire, Profile, Display, Runs, Spawn, Panes, Sessions, Proofs, Worktrees }

// The session's identity: set at session start (register.js) and by the pane polls (reaper.js), read through
// the Session view.
const { s: my, view } = makeStore('state.js', {
  worker: null,  // { agent, model, effort } from AGENTILLE_WORKER: this session is a worker pane
  selfName: null,  // this pane's name when it is an agt-* worker
  selfTab: null,  // herdr: the lead's own tab, where its workers split
  selfWorkspace: null,  // herdr: the lead's workspace, where a run tab opens
  sessionId: null,  // this session's id: workers it opens send their results here
  wireName: null,  // worker: its own agt- name (AGENTILLE_NAME), where it publishes
  leadSession: null,  // worker: the lead's session id (AGENTILLE_LEAD), where it reports
  leadModel: null,  // the main loop's model, for the tree's root
  leadTurn: false,  // a main-loop turn is running: its idle panes are waiting for review
  runningVersion: null,  // this module's own agentille version, read from its plugin.json at session start
  hostVersion: null,  // Claude Code's version from $.session.version(), null when unknown
  hostOld: false,  // the host is older than skew.js MIN_HOST: pane tools are never registered
  skewToasted: false,  // the person was told once that a newer agentille is installed
  weeklyPct: null,  // the seven-day rate limit used, from session.measure
})
export const Session = view

// Session start: what the environment says this session is.
export function setIdentity({ worker, sessionId, wireName, leadSession }) {
  Object.assign(my, { worker, sessionId, wireName, leadSession })
}

// A pane poll found this session's own pane: its agt- name (a worker), and on herdr its tab and workspace.
export function setSelfName(name) {
  my.selfName = name
}
export function setSelfPlace(tab, workspace) {
  my.selfTab = tab
  my.selfWorkspace = workspace
}

export function setRunningVersion(v) {
  my.runningVersion = v
}
export function setHostVersion(v) {
  my.hostVersion = v
}
export function markHostOld() {
  my.hostOld = true
}
export function markSkewToasted() {
  my.skewToasted = true
}
export function setWeeklyPct(p) {
  my.weeklyPct = p
}
export function setLeadModel(m) {
  my.leadModel = m
}
export function setLeadTurn(on) {
  my.leadTurn = on
}

// This session is the lead: no worker env and no agt- name of its own. The one lead/worker predicate.
export const isLead = () => !my.worker && !my.selfName

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
