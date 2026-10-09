// agentille links — who works on which piece, what each finished agent said, and the lead's side
// of the conversation. Pure on purpose: register.js reads headers and answers, board.js draws.

// `piece=<slug>` in the [agt …] header names the slice an agent builds, reviews or attacks.
const PIECE_RE = /^[a-z0-9][a-z0-9-]{0,23}$/
export const pieceOf = (hdr) => (PIECE_RE.test(String(hdr?.piece ?? '')) ? hdr.piece : null)

const isBuilder = (r) => (r.agent ?? r.role) === 'executor'
// The roles that check a built diff: every *-reviewer but the plan-reviewer, and the adversary.
const isChecker = (r) => {
  const role = String(r.agent ?? r.role ?? '')
  return role === 'adversary' || (role.endsWith('-reviewer') && role !== 'plan-reviewer')
}

// A finished agent's head as a chip: PASS · CONCERNS P1:2 · FAIL P0:1 · APPROVE · REVISE · HELD · BROKEN 2.
// tone is a theme color name. null when the answer has no head this role writes.
export function verdictChip(role, answer) {
  const a = String(answer ?? '')
  const r = String(role ?? '')
  if (r === 'plan-reviewer') {
    // The first verdict word decides, as routing.js verdictOf reads it.
    const v = /\b(APPROVE|REVISE)\b/.exec(a)?.[1]
    return v ? { text: v, tone: v === 'APPROVE' ? 'success' : 'warning' } : null
  }
  if (r === 'adversary') {
    const b = /\bBROKEN:\s*(\d+)/.exec(a)
    if (!b) return null
    const n = Number(b[1])
    return n ? { text: 'BROKEN ' + n, tone: 'error' } : { text: 'HELD', tone: 'success' }
  }
  if (r.endsWith('-reviewer')) {
    const v = /VERDICT:\s*(PASS|CONCERNS|FAIL)\b/.exec(a)?.[1]
    if (!v) return null
    const count = (p) => Number(new RegExp('\\b' + p + ':\\s*(\\d+)').exec(a)?.[1] ?? 0)
    const counts = v === 'PASS' ? [] : ['P0', 'P1'].filter((p) => count(p) > 0).map((p) => p + ':' + count(p))
    return { text: [v, ...counts].join(' '), tone: v === 'PASS' ? 'success' : v === 'FAIL' ? 'error' : 'warning' }
  }
  return null
}

// A piece's reviewers and adversary hang under the executor that built it, so the tree reads
// who checks whose diff. A row whose own parent is on screen keeps it; the newest builder of a
// piece wins (a fix attempt replaces the first build). With exactly one builder on screen, a checker
// that names no piece is that builder's: the common one-slice run, or a lead that left piece= out.
// Two builders and no piece say nothing about which diff a reviewer reads, so nothing is linked.
export function linkPieces(rows) {
  const builders = new Map()
  for (const r of rows) if (r.piece && isBuilder(r)) builders.set(r.piece, r.id)
  const all = rows.filter(isBuilder)
  const only = all.length === 1 ? all[0].id : null
  const ids = new Set(rows.map((r) => r.id))
  return rows.map((r) => {
    if (isBuilder(r) || !isChecker(r) || (r.parentId && ids.has(r.parentId))) return r
    const b = r.piece ? builders.get(r.piece) : only
    if (!b || b === r.id) return r
    return { ...r, parentId: b }
  })
}

// Who a wire line names: the role, plus its piece when it has one ("code-reviewer:api").
export const party = (role, piece = null) => String(role ?? '?') + (piece ? ':' + piece : '')

// The task line of a dispatch prompt: the first line that is not the header or the profile prefix.
export function taskLine(prompt, n = 70) {
  const line = String(prompt ?? '').split('\n').map((l) => l.trim()).find((l) => l && !/^\[agt\s/.test(l) && !/^(User|Avoid|Communicate):/.test(l)) ?? ''
  return line.length > n ? line.slice(0, n - 1) + '…' : line
}

// What a finished agent said back, in one line: its chip, else its first line.
export function answerLine(role, answer, n = 70) {
  const chip = verdictChip(role, answer)
  if (chip) return chip.text
  const line = String(answer ?? '').split('\n').map((l) => l.trim().replace(/^[#>*\s-]+/, '')).find(Boolean) ?? 'done'
  return line.length > n ? line.slice(0, n - 1) + '…' : line
}

// Retry loops of a run, for the band header: "plan ↺2 · fix ×3". '' when there were none.
export function loopText(run) {
  const parts = []
  if (run?.revise > 0) parts.push('plan ↺' + run.revise)
  if (run?.fixes > 0) parts.push('fix ×' + run.fixes)
  return parts.join(' · ')
}
