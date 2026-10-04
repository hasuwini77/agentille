import { describe, expect, test } from 'claude-code/testing'
import { cells, hatOf, pixels } from '../../hooks/sprites.js'

const ROLES = ['planner', 'plan-reviewer', 'ui-prototyper', 'executor', 'code-reviewer', 'design-reviewer', 'security-reviewer', 'payments-reviewer', 'seo-reviewer', 'perf-reviewer', 'Explore', 'adversary']

describe('wave sprites', () => {
  test('frames 2 and 3 are 16×16 with the raised arm', async () => {
    for (const role of ROLES) {
      const f0 = pixels(role, 0)
      const f2 = pixels(role, 2)
      const f3 = pixels(role, 3)
      for (const px of [f2, f3]) {
        expect(px.length).toBe(16)
        for (const line of px) expect(line.length).toBe(16)
        expect(px.slice(9)).toEqual(f0.slice(9))
      }
      for (const r of [5, 6, 7, 8]) expect(f2[r][15]).toBe('o')
      expect(f3[5][14]).toBe('o')
      expect(f3[6][14]).toBe('o')
      expect(f3[7][15]).toBe('o')
      expect(f3[8][15]).toBe('o')
      for (const r of [6, 7, 8]) expect(f0[r][15]).toBe('.')
      expect(f2).not.toEqual(f3)
      expect(cells(role, 'sonnet', 2).length).toBe(2048)
      expect(cells(role, 'sonnet', 2)).not.toBe(cells(role, 'sonnet', 0))
    }
  })

  test('frame 1 still bobs down one pixel', async () => {
    expect(pixels('executor', 1)[0]).toBe('................')
    expect(pixels('executor', 1).slice(1)).toEqual(pixels('executor', 0).slice(0, 15))
  })

  test('hatOf picks the look for a row', async () => {
    expect(hatOf({ agent: 'code-reviewer', role: 'review' })).toBe('code-reviewer')
    expect(hatOf({ agent: null, role: 'exec-1' })).toBe('executor')
    expect(hatOf({ role: 'exec' })).toBe('executor')
    expect(hatOf({ role: 'executor-ui' })).toBe('executor')
    expect(hatOf({ role: 'planner' })).toBe('planner')
    expect(hatOf({ agent: 'nope', role: 'exec-2' })).toBe('executor')
    expect(hatOf({ role: 'Explore' })).toBe('Explore')
  })
})
