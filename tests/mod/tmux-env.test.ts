import { describe, expect, test } from 'claude-code/testing'
import { tmuxInit, TMUX_LOCALE } from '../../hooks/tmux-env.js'
import { PROBE } from '../../hooks/panes.js'

describe('tmux locale', () => {
  test('a tmux argv runs with LC_ALL=C.UTF-8 on top of the caller env', async () => {
    expect(TMUX_LOCALE).toEqual({ LC_ALL: 'C.UTF-8' })
    expect(tmuxInit(['tmux', 'list-panes'], PROBE)).toEqual({ timeoutMs: PROBE.timeoutMs, env: { LC_ALL: 'C.UTF-8' } })
    expect(tmuxInit(['tmux', '-V'], { timeoutMs: 1, env: { FOO: 'bar', LC_ALL: 'C' } })).toEqual({ timeoutMs: 1, env: { FOO: 'bar', LC_ALL: 'C.UTF-8' } })
    expect(tmuxInit(['tmux', '-V'], undefined)).toEqual({ env: { LC_ALL: 'C.UTF-8' } })
    // PROBE itself is shared by every call: it is never written to.
    expect(PROBE).toEqual({ timeoutMs: PROBE.timeoutMs })
  })

  test('any other argv keeps its options as they are', async () => {
    expect(tmuxInit(['herdr', 'agent', 'list'], PROBE)).toBe(PROBE)
    expect(tmuxInit(['git', 'status'], undefined)).toBe(undefined)
  })

  test('every tmux call /agt-spawn makes carries the locale', { timeoutMs: 20_000 }, async ($, on) => {
    const calls: { argv: string[]; init: any }[] = []
    const vars: Record<string, string> = { TMUX: '/tmp/tmux-1/default,1,0', TMUX_PANE: '%1', SHELL: '/bin/zsh' }
    on('env.get', async ($: any, e: any) => ({ value: vars[e.name] }))
    on('session.cwd', async () => ({ value: '/work/repo' }))
    on('process.run', async ($: any, e: any) => {
      calls.push({ argv: e.argv, init: e.init })
      const stdout = e.argv[1] === 'split-window' ? '%9\n' : e.argv[1] === 'list-panes' ? '%1\t\t\t0\t@1\n%9\tagt-ab12cd-spawn\tclaude\t0\t@1\n' : ''
      return { value: { exitCode: 0, stdout, stderr: '' } }
    })
    const r = await $.command.run({ command: 'agt-spawn', args: '"reply with ok"', origin: { kind: 'composer' } } as never)
    expect(r.text).toMatch(/tmux pane\.$/)
    const tmux = calls.filter((c) => c.argv[0] === 'tmux')
    expect(tmux.map((c) => c.argv[1])).toEqual(expect.arrayContaining(['-V', 'split-window', 'set-option', 'select-pane']))
    for (const c of tmux) expect(c.init?.env?.LC_ALL).toBe('C.UTF-8')
    expect(calls.filter((c) => c.argv[0] !== 'tmux').every((c) => c.init?.env?.LC_ALL === undefined)).toBe(true)
  })
})
