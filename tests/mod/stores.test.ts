import { describe, expect, test } from 'claude-code/testing'
import * as state from '../../hooks/state.js'
import { Session, Proofs, Runs, Spawn, Panes, Sessions, Profile, Display, Wire, Timers, Worktrees, ctx, isLead, setLeadModel } from '../../hooks/state.js'
import { makeStore, seed } from '../../hooks/store.js'
import { agtTurnStart } from '../../hooks/proofs.js'
import { setLastRun, addDecision, adoptAgents, noteAgentTool } from '../../hooks/dispatch.js'
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

describe('stores: the view is deep', () => {
  const fresh = () => makeStore('deep.js', { rec: { n: 1, inner: { m: 1 } }, list: [{ k: 1 }], byId: new Map([['a', { v: 1 }]]), names: new Set(['x']), when: new Date(0) })

  test('a nested object, array, Map or Set read through a view throws on every write, naming the owner', () => {
    const { view } = fresh() as any
    const owner = /read-only here: deep\.js writes it through its transitions/
    expect(() => { view.rec.n = 2 }).toThrow(owner)
    expect(() => { view.rec.inner.m = 2 }).toThrow(owner)
    expect(() => { delete view.rec.n }).toThrow(owner)
    expect(() => Object.defineProperty(view.rec, 'n', { value: 3 })).toThrow(owner)
    expect(() => Object.assign(view.rec, { n: 4 })).toThrow(owner)
    expect(() => view.list.push({ k: 2 })).toThrow(owner)
    expect(() => { view.list[0].k = 2 }).toThrow(owner)
    expect(() => view.list.splice(0, 1)).toThrow(owner)
    expect(() => view.byId.set('b', { v: 2 })).toThrow(owner)
    expect(() => view.byId.delete('a')).toThrow(owner)
    expect(() => view.byId.clear()).toThrow(owner)
    expect(() => { view.byId.get('a').v = 2 }).toThrow(owner)
    expect(() => { for (const [, x] of view.byId) x.v = 2 }).toThrow(owner)
    expect(() => { view.byId.forEach((x: any) => { x.v = 2 }) }).toThrow(owner)
    expect(() => view.names.add('y')).toThrow(owner)
    expect(() => view.names.delete('x')).toThrow(owner)
    expect(view.rec).toEqual({ n: 1, inner: { m: 1 } }) // nothing landed
    expect(view.list).toEqual([{ k: 1 }])
    expect(view.byId.get('a')).toEqual({ v: 1 })
    expect([...view.names]).toEqual(['x'])
  })

  test('reads work as on the record: Map and Set get, has, size and iteration; one view per object', () => {
    const { s, view } = fresh() as any
    expect(view.byId.size).toBe(1)
    expect(view.byId.has('a')).toBe(true)
    expect(view.byId.get('a').v).toBe(1)
    expect([...view.byId.keys()]).toEqual(['a'])
    expect([...view.byId.values()].map((x: any) => x.v)).toEqual([1])
    expect(new Map(view.byId).get('a')).toEqual({ v: 1 })
    expect(view.byId instanceof Map).toBe(true)
    expect(view.names.has('x')).toBe(true)
    expect(view.list.map((x: any) => x.k)).toEqual([1])
    expect(Array.isArray(view.list)).toBe(true)
    expect(JSON.parse(JSON.stringify(view.rec))).toEqual({ n: 1, inner: { m: 1 } })
    expect({ ...view.rec }.n).toBe(1)
    expect(view.rec).toBe(view.rec)
    expect(view.byId.get('a')).toBe(view.byId.get('a'))
    expect(view.rec).not.toBe(s.rec)
    expect(view.when).toBe(s.when) // a Date is handed out as it is
  })

  test('the owner\'s own record writes at any depth, and the view follows; raw gives the owner its object back', () => {
    const { s, view, raw } = fresh() as any
    s.rec.inner.m = 5
    s.list.push({ k: 2 })
    s.byId.get('a').v = 7
    s.names.add('y')
    expect(view.rec.inner.m).toBe(5)
    expect(view.list.at(-1).k).toBe(2)
    expect(view.byId.get('a').v).toBe(7)
    expect(view.names.has('y')).toBe(true)
    expect(raw(view.rec)).toBe(s.rec)
    expect(raw(view.byId.get('a'))).toBe(s.byId.get('a'))
    expect(raw(42)).toBe(42)
    // Another store's raw never unwraps this one's views.
    const other = makeStore('other.js', {}) as any
    expect(other.raw(view.rec)).toBe(view.rec)
  })

  test('a store put back by seed from a copy of its view stays writable by its owner', () => {
    const saved = { live: new Map(Runs.live) }
    try {
      adoptAgents([{ id: 'st-deep-1', name: 'helper', status: 'running' }], 1000)
      const copy = new Map(Runs.live) // values are views
      seed(Runs, { live: copy })
      expect(noteAgentTool('st-deep-1', 'Read')).toBe(true) // the owner writes the record, not a view of it
      expect(Runs.live.get('st-deep-1').tool).toBe('Read')
      expect(() => { (Runs.live.get('st-deep-1') as any).tool = 'x' }).toThrow(/dispatch\.js writes it/)
    } finally {
      seed(Runs, saved)
    }
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
    expect(Sessions.sessions.at(-1)).toEqual(s)
    await forgetSession({} as never, s)
    expect(Sessions.sessions.some((x: any) => x.name === s.name)).toBe(false)
  })

  test('Sessions: a session read through the view is forgotten too', async () => {
    const s = { id: 'w1:p8', name: 's-st1-2', kind: 'shell', tab: null, terminal: null }
    addSession(s)
    const read = Sessions.sessions.find((x: any) => x.name === s.name)
    expect(read).not.toBe(s) // a view of the record, not the record
    await forgetSession({} as never, read)
    expect(Sessions.sessions.some((x: any) => x.name === s.name)).toBe(false)
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
