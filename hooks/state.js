// agentille mod state: the index of the session's stores. Each piece of state lives in the module that writes it
// (store.js makeStore), and every other module reads it through that owner's read view, re-exported here:
//
//   Session   session.js   who this session is (lead or worker, its names, ids and versions), the lead's turn
//   Proofs    proofs.js    the typed proofs the gates trust
//   Runs      dispatch.js  the run the band follows, per-run counters, live agents, decisions, pane routes
//   Spawn     spawn.js     the pane transport, the panes and run tabs this lead opened, the pane tools registered
//   Panes     reaper.js    the agt-* panes the newest poll listed
//   Sessions  sessions.js  the person's own sessions this lead opened
//   Profile   profile.js   home, routing settings, depth and squads, from profile.json and squads.json
//   Display   display.js   the display settings and switches, flags, the newest answer, the worker band's mascot
//   Wire      worker.js    the wire log, each worker's published status, this worker's own
//   Timers    ticker.js    the redraw count
//   Worktrees guard-own.js the worktrees this session's runs made
//
// This file defines nothing: it is an index for the modules that own no store (register.js, render.js, tools.js, …).
// No module it imports may import it, directly or through another module (scripts/validate.sh checks): an owner
// imports session.js and the owners it reads from directly. A module writes only its own store, through its
// transitions: a view throws on any write, at any depth. Everything here lives for the session (a reload starts
// it over); nothing is persisted from here but through $.store and the run files. What the lead keeps about each
// pane (harvest, wake, stranded, first seen, stage) is in panerec.js.

export * from './session.js'
export { Timers } from './ticker.js'
export { Wire } from './worker.js'
export { Profile } from './profile.js'
export { Display } from './display.js'
export { Runs } from './dispatch.js'
export { Spawn } from './spawn.js'
export { Panes } from './reaper.js'
export { Sessions } from './sessions.js'
export { Proofs } from './proofs.js'
export { Worktrees } from './guard-own.js'
