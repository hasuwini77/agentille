import { describe, expect, mock, test } from 'claude-code/testing'
import { TIP, canDraw, drawingBlock, reportRun, reportTail } from '../../hooks/drawing.js'

const agent = (role: string, start: number, over: object = {}) => ({ role, model: 'claude-sonnet-5', effort: 'medium', start, end: start + 65_000, input: 12_300, output: 900, ...over })

describe('drawing: pure', () => {
  test('only a terminal or desktop surface draws the band', async () => {
    expect(canDraw(['terminal'])).toBe(true)
    expect(canDraw(['vscode', 'desktop'])).toBe(true)
    expect(canDraw(['vscode'])).toBe(false)
    expect(canDraw([])).toBe(false)
    expect(canDraw(undefined)).toBe(false)
  })

  test('the marker is there only when the mod draws', async () => {
    expect(drawingBlock(false)).toBe('')
    expect(drawingBlock(true)).toContain('## Drawing (agentille mod)')
    expect(drawingBlock(true)).toContain('mod draws: yes')
  })

  test('a run report path gives its run id; anything else gives null', async () => {
    expect(reportRun('/h/.agentille/state/run-ab12cd/report.md')).toBe('ab12cd')
    expect(reportRun('/h/.agentille/state/run-ab12cd/notes.md')).toBe(null)
    expect(reportRun('/h/.agentille/state/run-../report.md')).toBe(null)
    expect(reportRun('/repo/report.md')).toBe(null)
    expect(reportRun(undefined)).toBe(null)
  })

  test('the tail adds Agents in start order, panes, and raw reports', async () => {
    const tail = reportTail('# run\n## Result\nok\n', {
      agents: [agent('code-reviewer', 2000, { model: 'claude-opus-5', effort: 'high' }), agent('executor', 1000)],
      routes: [{ agent: 'executor', model: 'sonnet', effort: 'high', start: 0, end: 120_000 }],
      files: ['executor-1.md', 'code-reviewer-1.md'],
    })
    const lines = tail.split('\n')
    expect(lines[0]).toBe('')
    expect(lines.indexOf('| executor | sonnet · medium | 1:05 | 12.3k / 900 |')).toBeLessThan(lines.indexOf('| code-reviewer | opus · high | 1:05 | 12.3k / 900 |'))
    expect(tail).toContain('| executor (pane) | sonnet · high | 2:00 | n/a |')
    expect(tail).toContain('## Raw reports\n\n- [code-reviewer-1.md](agents/code-reviewer-1.md)\n- [executor-1.md](agents/executor-1.md)')
  })

  test('sections the lead already wrote are left alone', async () => {
    const both = '## Agents\nx\n## Raw reports\ny\n'
    expect(reportTail(both, { agents: [agent('executor', 0)], files: ['executor-1.md'] })).toBe('')
    expect(reportTail('## Agents\nx\n', { agents: [agent('executor', 0)], files: [] })).toBe('')
    expect(reportTail('no newline', { agents: [], files: ['a.md'] }).startsWith('\n\n## Raw reports')).toBe(true)
  })
})

describe('drawing: in the mod', () => {
  const boot = async ($: any, on: any, surfaces: string[], files: Record<string, string> = {}) => {
    const toasts: string[] = []
    const written: Record<string, string> = {}
    on('env.get', async ($: any, e: any) => ({ value: ({ HOME: '/h' } as any)[e.name] }))
    on('process.run', async () => ({ value: { exitCode: 127, stdout: '', stderr: '' } }))
    on('session.start', async ($: any, e: any) => ({ cwd: e.cwd }))
    on('session.surfaces', async () => ({ value: surfaces }) as never)
    on('command.register', async () => ({ value: undefined }))
    on('fs.read', async ($: any, e: any) => (e.path in files || e.path in written ? { value: written[e.path] ?? files[e.path] } : { deny: 'missing' }))
    on('fs.exists', async ($: any, e: any) => ({ value: e.path in files || e.path in written }))
    on('fs.list', async () => ({ value: [{ name: 'executor-1.md', kind: 'file' }] }) as never)
    on('fs.write', async ($: any, e: any) => { written[e.path] = e.content ?? e.text ?? e.data; return { value: undefined } })
    on('store.get', async () => ({ value: undefined }))
    on('ui.toast', async ($: any, e: any) => { toasts.push(e.text ?? String(e)); return { value: undefined } })
    on('skill.prompt', async ($: any, e: any) => ({ text: e.text }))
    on('tool.call', async () => ({ result: {}, text: 'ok' }) as never)
    on('ui.render', async () => ({ type: 'engine', ref: 0 }) as never)
    on('agent.list', async () => ({ value: [] }) as never)
    mock.clock(on, { now: 1_000_000 })
    await $.session.start({ cwd: '/w', surface: null, isInteractive: false })
    return { toasts, written }
  }

  test('a drawing session gets the marker and, with no profile, the tip once', async ($, on) => {
    const { toasts, written } = await boot($, on, ['terminal'])
    const r = await $.skill.prompt({ skill: 'agt', text: 'base' })
    expect(r.text).toContain('## Drawing (agentille mod)')
    expect(toasts).toEqual([TIP])
    expect('/h/.agentille/state/.tip-shown' in written).toBe(true)
    await $.skill.prompt({ skill: 'agt', text: 'base' })
    expect(toasts).toEqual([TIP])
  })

  test('a session that draws nothing gets no marker and no toast', async ($, on) => {
    const { toasts } = await boot($, on, [])
    const r = await $.skill.prompt({ skill: 'agt', text: 'base' })
    expect(r.text).not.toContain('## Drawing')
    expect(toasts).toEqual([])
  })

  test("the lead's report.md gets the sections it lacks", async ($, on) => {
    const path = '/h/.agentille/state/run-r1/report.md'
    const { written } = await boot($, on, ['terminal'], { [path]: '# /agt run r1\n## Result\nok\n' })
    await $.tool.call({ tool: 'Write', file_path: path, content: 'x' } as never)
    expect(written[path]).toContain('## Raw reports\n\n- [executor-1.md](agents/executor-1.md)')
    expect(written[path].startsWith('# /agt run r1\n## Result\nok\n')).toBe(true)
  })
})
