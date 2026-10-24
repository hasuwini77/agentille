import { describe, expect, test } from 'claude-code/testing'
import * as state from '../../hooks/state.js'
import { Session, Proofs, Runs, Spawn, Panes, Sessions, Profile, Display, Wire, Timers, Worktrees, ctx, isLead, setLeadModel } from '../../hooks/state.js'
import { makeStore, seed } from '../../hooks/store.js'
import { agtTurnStart } from '../../hooks/proofs.js'
import { setLastRun, addDecision, adoptAgents } from '../../hooks/dispatch.js'
import { probeTransport, ownName } from '../../hooks/spawn.js'
import { pollNow } from '../../hooks/reaper.js'
import { addSession, forgetSession } from '../../hooks/sessions.js'
import { loadProfile } from '../../hooks/profile.js'
import { addFlag, clearFlags, mascotHello, mascotWorking, mascotRest } from '../../hooks/display.js'
import { noteWire, pubTool } from '../../hooks/worker.js'
import { ensureTicker } from '../../hooks/ticker.js'

// Each piece of session state lives in the module that writes it; everyone else reads it through a view.
const VIEWS = { Session, Proofs, Runs, Spawn, Panes, Sessions, Profile, Display, Wire, Timers, Worktrees }

describe('stores: a module writes only its own', () => {
  test('state.js holds no writable record: only the views, isLead and ctx', () => {
    expect((state as any).S).toBe(undefined)
    for (const v of Object.values(VIEWS)) expect(typeof v).toBe('object')
  })

  test('every view throws on assignment, delete and Object.assign, naming the owner', () => {
    for (const [name, v] of Object.entries(VIEWS)) {
      const key = Object.keys(v)[0]
      const before = (v as any)[key]
      expect(() => { (v as any)[key] = 'x' }).toThrow(TypeError)
      expect(() => { delete (v as any)[key] }).toThrow(TypeError)
      expect(() => Object.assign(v, { [key]: 'x' })).toThrow(TypeError)
      expect(() => { (v as any).added = 1 }).toThrow(TypeError)
      expect((v as any)[key]).toBe(before) // nothing landed
      expect((v as any).added).toBe(undefined)
      let msg = ''
      try { (v as any)[key] = 'x' } catch (err: any) { msg = String(err.message) }
      expect(msg).toMatch(/\.js writes it through its transitions$/)
      expect(name.length).toBeGreaterThan(0)
    }
  })

  test('the view is live and read-only; the owner record writes; seed is the tests-only way past it', () => {
    const { s, view } = makeStore('x.js', { n: 1 })
    s.n = 2
    expect(view.n).toBe(2)
    expect(() => { (view as any).n = 3 }).toThrow(/n is read-only here: x\.js writes it/)
    expect(seed(view, { n: 4 })).toEqual({ n: 2 })
    expect(view.n).toBe(4)
    expect(() => seed({ n: 1 } as any, { n: 2 })).toThrow(TypeError)
  })
})

describe('stores: each view follows its owner\'s transitions', () => {
  test('Session: setLeadModel; ctx and isLead read the same store', () => {
    const was = Session.leadModel
    setLeadModel('opus-test')
    expect(Session.leadModel).toBe('opus-test')
    setLeadModel(was)
    expect(Session.leadModel).toBe(was)
    expect(ctx.isLead).toBe(isLead())
  })

  test('Proofs: agtTurnStart', () => {
    const was = Proofs.agtTurn
    agtTurnStart(true)
    expect(Proofs.agtTurn).toBe(true)
    agtTurnStart(false)
    expect(Proofs.agtTurn).toBe(false)
    agtTurnStart(was)
  })

  test('Runs: setLastRun, addDecision and adoptAgents; ctx.run and ctx.live follow', () => {
    const saved = { lastRun: Runs.lastRun, decisions: [...Runs.decisions], live: new Map(Runs.live) }
    try {
      setLastRun('st1')
      expect(Runs.lastRun).toBe('st1')
      expect(ctx.run).toBe('st1')
      addDecision({ role: 'executor', model: 'sonnet', effort: 'medium', reason: 'table' })
      expect(Runs.decisions.at(-1)).toEqual({ role: 'executor', model: 'sonnet', effort: 'medium', reason: 'table' })
      adoptAgents([{ id: 'st-agent-1', name: 'helper', status: 'running' }], 1000)
      expect(ctx.live).toBe(Runs.live)
    } finally {
      setLastRun(saved.lastRun)
      seed(Runs, { decisions: saved.decisions, live: saved.live })
    }
  })

  test('Spawn: probeTransport and ownName', async () => {
    const saved = { transport: Spawn.transport, openedNames: new Set(Spawn.openedNames) }
    const $ = { env: { get: async () => undefined }, process: { run: async () => ({ exitCode: 1, stdout: '', stderr: '' }) } }
    try {
      expect(await probeTransport($ as never)).toBe('none')
      expect(Spawn.transport).toBe('none')
      ownName('agt-st1-executor')
      expect(Spawn.openedNames.has('agt-st1-executor')).toBe(true)
    } finally {
      seed(Spawn, saved)
    }
  })

  test('Panes, Session and Timers: a worker\'s poll lists its siblings and names it; the ticker counts while one works', async () => {
    let agents: any[] = [
      { name: 'agt-st1-planner', pane_id: 'w1:p1', agent: 'claude', agent_status: 'working', state_change_seq: 1, tab_id: 'w1:t1', workspace_id: 'w1' },
      { name: 'agt-st1-executor', pane_id: 'w1:p2', agent: 'claude', agent_status: 'working', state_change_seq: 2, tab_id: 'w1:t1', workspace_id: 'w1' },
    ]
    let every: (() => Promise<void>) | null = null
    const $ = {
      process: { run: async (argv: string[]) => ({ exitCode: 0, stderr: '', stdout: argv.join(' ') === 'herdr agent list' ? JSON.stringify({ result: { agents } }) : '' }) },
      env: { get: async (k: string) => (k === 'HERDR_PANE_ID' ? 'w1:p1' : undefined) },
      clock: { now: async () => 1_000, every: (_ms: number, fn: () => Promise<void>) => { every = fn; return { cancel: () => { every = null } } } },
      fs: { read: async () => '', write: async () => {}, list: async () => [], exists: async () => false },
      store: { get: async () => undefined, set: async () => {} },
      ui: { invalidate: () => {}, toast: () => {}, status: () => {} },
      agent: { list: async () => [] },
    }
    const tick = Timers.tick
    const workspace = Session.selfWorkspace
    try {
      await pollNow($ as never, 'herdr')
      expect(Session.selfName).toBe('agt-st1-planner')
      expect(Session.selfTab).toBe('w1:t1')
      expect(isLead()).toBe(false)
      expect(Panes.panes.map((p: any) => p.name)).toEqual(['agt-st1-executor'])
      expect(ctx.panes).toBe(Panes.panes)
      ensureTicker($ as never)
      await every!()
      expect(Timers.tick).toBe(tick + 1)
      expect(ctx.tick).toBe(Timers.tick)
    } finally {
      agents = []
      await pollNow($ as never, 'herdr')
      if (every) await (every as () => Promise<void>)() // nothing works now: the ticker stops itself
      seed(Session, { selfWorkspace: workspace })
    }
    expect(Session.selfName).toBe(null)
    expect(Panes.panes).toEqual([])
    expect(every).toBe(null)
  })

  test('Sessions: addSession and forgetSession', async () => {
    const s = { id: 'w1:p9', name: 's-st1-1', kind: 'shell', tab: null, terminal: null }
    addSession(s)
    expect(Sessions.sessions.at(-1)).toBe(s)
    await forgetSession({} as never, s)
    expect(Sessions.sessions.includes(s)).toBe(false)
  })

  test('Profile: loadProfile reads home and marks a missing profile', async () => {
    const saved = { home: Profile.home, profileMissing: Profile.profileMissing }
    const display = { profileDisplay: Display.profileDisplay }
    const $ = { env: { get: async (k: string) => (k === 'HOME' ? '/h-st' : undefined) }, fs: { read: async () => { throw new Error('no profile') } } }
    try {
      await loadProfile($ as never)
      expect(Profile.home).toBe('/h-st')
      expect(Profile.profileMissing).toBe(true)
      expect(Display.profileDisplay).toEqual({})
    } finally {
      seed(Profile, saved)
      seed(Display, display)
    }
  })

  test('Display: addFlag, clearFlags and the mascot transitions', () => {
    const saved = { flags: Display.flags, mascot: { ...Display.mascot } }
    const toasts: string[] = []
    try {
      addFlag({ ui: { toast: (t: string) => toasts.push(t) } } as never, 'st|1', 'run st1: REVISE')
      expect(Display.flags.map((f: any) => f.text)).toContain('run st1: REVISE')
      expect(toasts).toEqual(['agt ⚑ run st1: REVISE'])
      clearFlags()
      expect(Display.flags).toEqual([])
      seed(Display, { mascot: { greeted: false, hiUntil: 0, byeUntil: 0, working: false, start: 0, ms: null } })
      expect(mascotHello(100)).toBe(true)
      expect(mascotHello(200)).toBe(false)
      mascotWorking(300)
      expect(Display.mascot.working).toBe(true)
      mascotRest(800, true)
      expect(Display.mascot).toMatchObject({ greeted: true, working: false, ms: 500 })
      expect(Display.mascot.byeUntil).toBeGreaterThan(800)
    } finally {
      seed(Display, saved)
    }
  })

  test('Wire: noteWire and pubTool', () => {
    const saved = { wireLog: [...Wire.wireLog], tool: Wire.pub.tool }
    try {
      noteWire({ from: 'lead', to: 'executor', kind: 'task', summary: 'st1', at: 1 })
      expect(Wire.wireLog.at(-1)).toMatchObject({ from: 'lead', kind: 'task', summary: 'st1' })
      pubTool('Read')
      expect(Wire.pub.tool).toBe('Read')
    } finally {
      pubTool(saved.tool)
      seed(Wire, { wireLog: saved.wireLog })
    }
  })
})
