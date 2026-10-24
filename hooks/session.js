// agentille session: who this session is (lead or worker, its names, ids and versions), the lead's turn, the one
// lead/worker predicate and `ctx`. A leaf: it imports only store.js, so any module can import it without a cycle.

import { makeStore } from './store.js'

// The session's identity: set at session start (register.js) and by the pane polls (reaper.js), read through
// the Session view.
const { s: my, view } = makeStore('session.js', {
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

// What the modules wired last in register(on) read: live state through getters, since most of it is reassigned.
// The owners of that state hand ctx their views as they load (ctxSource), so this file imports none of them.
const sources = { runs: null, timers: null, panes: null }

export function ctxSource(views) {
  for (const k of Object.keys(views)) if (k in sources) sources[k] = views[k]
}

export const ctx = {
  get live() { return sources.runs?.live },
  get run() { return sources.runs?.lastRun },
  get tick() { return sources.timers?.tick },
  get panes() { return sources.panes?.panes },
  get routes() { return sources.runs?.paneRoutes },
  get isLead() { return isLead() },
  onTick: [], // (io, ctx, now) callbacks the redraw ticker calls each period; a module adds its own while registering
}
