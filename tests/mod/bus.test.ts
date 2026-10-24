import { describe, expect, test } from 'claude-code/testing'
import { on, emit } from '../../hooks/bus.js'
import { Display, Runs, Wire } from '../../hooks/state.js'
import { seed } from '../../hooks/store.js'
import { loadProfile } from '../../hooks/profile.js'
import { dispatchAgent, setLastRun } from '../../hooks/dispatch.js'

// Owners that would import each other reach the peer's transition through bus.js: the owner registers it as it
// loads, the caller emits at call time.
describe('bus: a transition reached without an import', () => {
  test('emit calls every handler in order with the payload; an unknown event does nothing', () => {
    const got: string[] = []
    on('bus-test.a', (p: any) => got.push('1:' + p))
    on('bus-test.a', (p: any) => got.push('2:' + p))
    emit('bus-test.a', 'x')
    emit('bus-test.none', 'y')
    expect(got).toEqual(['1:x', '2:x'])
  })

  test('what a handler throws reaches the caller, as a direct call would', () => {
    on('bus-test.b', () => { throw new Error('boom') })
    expect(() => emit('bus-test.b', null)).toThrow('boom')
  })

  test('loadProfile hands profile.json → display to display.js', async () => {
    const saved = { profileDisplay: Display.profileDisplay }
    const $ = {
      env: { get: async (k: string) => (k === 'HOME' ? '/h-bus' : undefined) },
      fs: { read: async () => JSON.stringify({ name: 'x', display: { deck: 'off', bogus: 1 } }) },
    }
    try {
      await loadProfile($ as never)
      expect(Display.profileDisplay).toEqual({ deck: 'off' })
    } finally {
      seed(Display, saved)
    }
  })

  test('a routed dispatch notes its task on the wire', async () => {
    const saved = { wireLog: [...Wire.wireLog] }
    const run = { lastRun: Runs.lastRun, live: new Map(Runs.live), decisions: [...Runs.decisions] }
    const $ = {
      store: { get: async () => undefined, set: async () => undefined },
      fs: { write: async () => undefined },
      ui: { toast: () => {}, invalidate: () => {} },
    }
    const next = async (e: any) => ({ model: e.model ?? 'sonnet', agentId: 'bus-a1' })
    try {
      await dispatchAgent($ as never, { prompt: '[agt run=bus1 size=small mode=build fable=auto]\nplan it', subagentType: 'agentille:agentille-planner', model: 'opus' }, next)
      expect(Wire.wireLog.at(-1)).toMatchObject({ from: 'lead', kind: 'task', via: 'sub' })
    } finally {
      seed(Wire, { wireLog: saved.wireLog })
      seed(Runs, { live: run.live, decisions: run.decisions })
      setLastRun(run.lastRun)
    }
  })
})
