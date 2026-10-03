// Mini-Claude sprites for the deck: one body, a hat per role, hat color per model.
// 16×16 pixels drawn as 16×8 half-block cells (a Raster), two frames for a bob.

const DEFAULT = 0x01000000 // the terminal's own color

export const MODEL_COLOR = {
  haiku: 0x9aa0a6,
  sonnet: 0x4f8ef7,
  opus: 0xf2a33a,
  fable: 0xa77bff,
  other: 0xc8c8c8,
}

const FIXED = { o: 0xd97757, k: 0x1a1a1a, d: 0x2b2b2b, w: 0xf5f5f5, y: 0xf5c518, c: 0x7fd3e6 }

const BODY = [
  '...oooooooooo...',
  '..oooooooooooo..',
  '..ookkooookkoo..',
  '.oooooooooooooo.',
  '.oooooooooooooo.',
  '..oooooooooooo..',
  '..oooooooooooo..',
  '...o.o....o.o...',
  '...o.o....o.o...',
  '................',
]

const BLANK = '................'

// Rows 0–5 sit above the body. `over` replaces body pixels by absolute row; '_' keeps the pixel.
const LOOKS = {
  planner: {
    hat: ['....hhhhhhhh....', '....hhhhhhhh....', '....hhhhhhhh....', '....dddddddd....', '....hhhhhhhh....', '..hhhhhhhhhhhh..'],
    over: { 8: '___dkkddddkkd___' },
  },
  'plan-reviewer': {
    hat: [BLANK, BLANK, BLANK, '....hhhhhhhh....', '...hhhhhhhhhh...', '...hhhhhhhhhhhhh'],
  },
  'ui-prototyper': {
    hat: [BLANK, BLANK, '.......dd.......', '....hhhhhhhh....', '..hhhhhhhhhhhh..', '...hhhhhhhhhh...'],
  },
  executor: {
    hat: [BLANK, '......hhhh......', '....hhhhhhhh....', '...hhhhhhhhhh...', '...hhhhhhhhhh...', '..hhhhhhhhhhhh..'],
  },
  'code-reviewer': {
    hat: [BLANK, BLANK, '.....hhhhhh.....', '....hdhhhhdh....', '..hhhhhhhhhhhh..', '...dd......dd...'],
    over: { 8: '_________dkkd___' },
  },
  'design-reviewer': {
    hat: [BLANK, BLANK, '....dddddddd....', '...d........d...', '..d..........d..', '..hh........hh..'],
    over: { 6: '.hh__________hh.', 7: '.hh__________hh.' },
  },
  'security-reviewer': {
    hat: [BLANK, '....hhhhhhhh....', '...hhhhhhhhhh...', '..hhhhhhhhhhhh..', '..hhhhhhhhhhhh..', '..hhhhhhhhhhhh..'],
    over: { 8: '___cccccccccc___' },
  },
  'payments-reviewer': {
    hat: [BLANK, BLANK, '...y..y..y..y...', '...yyyyyyyyyy...', '...yhyyhhyyhy...', '...yyyyyyyyyy...'],
  },
  'seo-reviewer': {
    hat: ['......hh........', '......hh........', '.......d........', '.......d........', '.......d........', '....dddddd......'],
  },
  'perf-reviewer': {
    hat: [BLANK, BLANK, BLANK, BLANK, BLANK, BLANK],
    over: { 6: '...hhhhhhhhhh...', 9: 'd_______________', 10: '_d______________' },
  },
}

const NO_HAT = { hat: [BLANK, BLANK, BLANK, BLANK, BLANK, BLANK] }

export function modelKey(model) {
  const m = String(model ?? '').toLowerCase()
  for (const k of ['fable', 'opus', 'sonnet', 'haiku']) if (m.includes(k)) return k
  return 'other'
}

export function pixels(role, frame = 0) {
  const look = LOOKS[role] ?? NO_HAT
  const rows = [...look.hat, ...BODY]
  for (const [r, line] of Object.entries(look.over ?? {})) {
    const i = Number(r)
    rows[i] = [...rows[i]].map((ch, c) => (line[c] === '_' ? ch : line[c])).join('')
  }
  // Frame 1 bobs the whole sprite down one pixel; the last row is always blank.
  return frame === 1 ? [BLANK, ...rows.slice(0, 15)] : rows
}

// Packs 16×16 pixels into 16×8 half-block cells: [codepoint, fg, bg] per cell, base64.
export function cells(role, model, frame = 0) {
  const pal = { ...FIXED, h: MODEL_COLOR[modelKey(model)] }
  const px = pixels(role, frame)
  const nums = []
  for (let r = 0; r < 16; r += 2) {
    for (let c = 0; c < 16; c++) {
      const top = pal[px[r][c]] ?? DEFAULT
      const bot = pal[px[r + 1][c]] ?? DEFAULT
      if (top === DEFAULT && bot === DEFAULT) nums.push(32, DEFAULT, DEFAULT)
      else if (top === DEFAULT) nums.push(0x2584, bot, DEFAULT)
      else nums.push(0x2580, top, bot)
    }
  }
  return new Uint8Array(Uint32Array.from(nums).buffer).toBase64()
}
