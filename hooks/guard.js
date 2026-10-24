// agentille guard: what a run's Bash and file-write calls may do on their own, and which worktrees a run made.
// The guard is split across three modules; this file wires the hooks and re-exports their public surface, so
// every existing import of ./guard.js keeps working.
//
//   guard-lex.js    — the shell lexer: reads a line the way the shell would (words, quotes, $( ), heredocs,
//                     wrappers, interpreters, the variables set on the line) and turns it into candidates.
//   guard-policy.js — the policy: the integration mode for the repo a command targets, and the judgements on
//                     pushes, merges, tags, releases, ref writes, the GitHub API, scripts and recipes.
//   guard-own.js    — worktree ownership: which worktrees a run made, so the cleaner touches only those.
//
//   integration — `auto` (merge, tag and push with no human step) holds only where the person's own
//                 ~/.agentille/profile.json says so for the repo the command targets; the repo may lower it,
//                 never raise it, and a profile read mid-run can lower but never raise the run's snapshot.
//                 Below `auto`, a run's merge, tag, release and API merge are denied, so is any push but one of
//                 its own branch, and so is a write to the trust root (~/.agentille) or the repo's own git state.
//   ownership   — every worktree a run's `git worktree add` created is recorded, so the cleaner removes
//                 only those and never another session's fresh checkout.
//
// A session where /agt was never typed is untouched: its Bash and writes run as the engine runs them.

import { S } from './state.js'
import { ROLES } from './routing.js'
import { SPAWN_ROLE, splitName } from './panes.js'
import { moment, inFlight, runHeld } from './proofs.js'
import { reportRun } from './drawing.js'
import { completeReport } from './dispatch.js'
import { joinPath, protectedPath } from './guard-lex.js'
import { DENY_UNREAD, denyProtected, guardLine, integrationAllowed, readProfile } from './guard-policy.js'
import { WT_SCRIPT, listTrees, newTrees, claimedTrees, scriptTrees, scriptSlugs, worktreeAdds, saveOwned, runOf } from './guard-own.js'

// Re-exports: every name ./guard.js used to carry still resolves here.
export { protectedPath, SHELLS, commands, splitCommands, gitCall, commandSteps, joinPath, MENTIONS_TOOL, SCRIPT_RISK, MAKE_RISK } from './guard-lex.js'
export { DENY_INTEGRATION, DENY_PUSH, DENY_LOCAL, DENY_UNREAD, denyHidden, denyProtected, judgePush, judgeRef, judgeLocal, integrationIn, integrationOf, integrationAllowed, guardLine, makeRecipe, normUrl, normSlug, sameRemote, capsOf } from './guard-policy.js'
export { OWNED_TTL_MS, worktreeAdds, newTrees, WT_SCRIPT, scriptTrees, scriptSlugs, claimedTrees, recordTrees, parseOwned, worktreesFile, saveOwned, ownedWorktrees, forgetOwned } from './guard-own.js'

// ── who is a run ─────────────────────────────────────────────────────────────
// An agentille subagent, a worker pane (not a /agt-spawn pane: that is the person's own task), or the lead
// on an /agt turn, from the turn its run names an id until that run's ✓/✗ card (proofs.js runHeld; no clock
// or typed-reply count ends it), or while a run with no id is in flight (routing.js runInFlight, on the clocks
// proofs.js moment($) read): a question typed mid-run does not switch the guard off. A plain session has none.
export function fromRun(e, at) {
  if (e.agentId) {
    const a = S.live.get(e.agentId)
    if (a && ROLES.includes(a.role)) return true
  }
  if (S.worker) return S.worker.agent !== SPAWN_ROLE
  const self = splitName(S.wireName ?? S.selfName)
  if (self) return self.role !== SPAWN_ROLE
  return !!S.agtTurn || runHeld() || inFlight(S, at)
}

// ── the Bash hook ────────────────────────────────────────────────────────────
export async function bashCall($, e, next) {
  const line = String(e.command ?? '')
  if (!fromRun(e, await moment($))) return next(e)
  const cwd = await $.session.cwd().catch(() => null)
  // Probing that throws is no answer: the command does not run unread.
  const deny = await guardLine($, line, cwd).catch(() => DENY_UNREAD)
  if (deny) return { deny }
  const script = WT_SCRIPT.test(line)
  if (!script && !/\bworktree\s+add\b/.test(line)) return next(e)
  const before = cwd ? await listTrees($, cwd) : null
  const res = await next(e)
  if (res?.deny) return res
  const after = before ? await listTrees($, cwd) : null
  const at = Date.now()
  const run = runOf(e)
  const had = new Set((before ?? []).map((t) => t.path))
  // A tree that was already there (a re-attach) has no fork point to read from the call: recordTrees keeps the
  // first record's, else none.
  const rec = (t, src) => ({ path: t.path, branch: t.branch, head: had.has(t.path) ? null : t.head ?? null, run, at, src })
  let made = after ? newTrees(before, after, line).map((t) => rec(t, 'add')) : []
  if (script && after) for (const t of claimedTrees(scriptTrees(res?.result), after, scriptSlugs(line))) made = [...made.filter((m) => m.path !== t.path), rec(t, 'script')]
  // git could not be read around the call: the literal command is all there is.
  if (!after && cwd) made = worktreeAdds(line, cwd).filter((w) => w.path && w.branch).map((w) => ({ path: w.path, branch: w.branch, head: null, run, at, src: 'add' }))
  if (made.length) await saveOwned($, made)
  return res
}

// ── the profile snapshot ─────────────────────────────────────────────────────
// The profile the run started with: read at the typed /agt so a later read cannot raise the mode mid-run (capMode).
export async function loadRunProfile($) {
  S.agtProfile = await readProfile($)
}

// ── the non-Bash write hooks ─────────────────────────────────────────────────
// A write (Write, Edit, MultiEdit, NotebookEdit) to the trust root or the repo's own git state, refused below
// auto exactly as a Bash write is. Returns the deny reason, or null to let it through.
async function editDeny($, e) {
  const path = e.file_path ?? e.notebook_path ?? e.path ?? null
  if (!path || !fromRun(e, await moment($))) return null
  const cwd = await $.session.cwd().catch(() => null)
  const abs = path.startsWith('/') ? joinPath('/', path) : !/[$`~]/.test(path) && cwd ? joinPath(cwd, path) : null
  const lbl = protectedPath(path, abs)
  if (!lbl) return null
  const mode = await integrationAllowed($, cwd).catch(() => 'pr')
  return mode === 'auto' ? null : denyProtected(lbl)
}

// The Write hook: refuse a protected write; else let it through, then observe a run's report write for the band.
export async function writeCall($, e, next) {
  const deny = await editDeny($, e).catch(() => null)
  if (deny) return { deny }
  const r = await next(e)
  if (!e.agentId && reportRun(e.file_path)) await completeReport($, e.file_path).catch(() => {})
  return r
}

// The Edit / MultiEdit / NotebookEdit hook: refuse a protected write, else let it through.
export async function editCall($, e, next) {
  const deny = await editDeny($, e).catch(() => null)
  return deny ? { deny } : next(e)
}
