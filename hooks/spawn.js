// agentille worker panes: the pane transport (Herdr, tmux or none), opening one routed claude pane beside the
// lead (split or run tab), the startup dialogs it clears, the run tabs a lead records, and the pane tools'
// registration on the typed prompt that unlocks them.

import { S, isLead } from './state.js'
import { PROBE, HERDR_START_TIMEOUT, pickTransport, splitName, paneKey, answerFile, advisorEnv, tmuxSplitArgv, tmuxEvenArgv, tmuxTagArgvs, tmuxPaneIdOf, tmuxKillArgv, herdrSplitArgv, herdrPaneIdOf, herdrTabArgv, herdrTabOf, herdrTabListArgv, herdrTabIds, tabsFile, panesFile, startupDialog, dialogKeys, herdrReadArgv, herdrKeysArgv, agentStatusOf, herdrGetArgv, screenLine, codexTask, herdrStartArgv, herdrPromptArgv, herdrCloseArgv, herdrMetaArgv, SPAWN_TOOL, CLOSE_TOOL, OPEN_SESSIONS_TOOL } from './panes.js'
import { wireEnv, shortName } from './wire.js'
const { ownedTabs, openedNames } = S

export async function probeOk($, argv) {
  try {
    return (await $.process.run(argv, PROBE)).exitCode === 0
  } catch {
    return false
  }
}

// herdr → tmux → none. A probe that rejects or exits non-zero counts as unavailable; so
// does a host with no $.process (desktop app, VS Code), where the call itself throws.
export async function detectTransport($) {
  const herdrOk = (await $.env.get('HERDR_ENV')) === '1' && (await probeOk($, ['herdr', '--version']))
  const tmuxOk = !herdrOk && ((await $.env.get('TMUX')) ?? '') !== '' && (await probeOk($, ['tmux', '-V']))
  return pickTransport({ herdrOk, tmuxOk })
}

export async function transportOf($) {
  S.transport ??= await detectTransport($)
  return S.transport
}

// The run tabs this lead made, one id per line where the SessionEnd sweep reads them. A failed write loses
// only the sweep's reach, so it never blocks.
export async function saveTabs($) {
  const file = tabsFile(S.home, await $.env.get('HERDR_PANE_ID'))
  if (file) await $.fs.write(file, [...ownedTabs].map((t) => t + '\n').join('')).catch(() => {})
}

// The lead's pane id in this transport: where its tabs, panes and sessions files are keyed.
export async function leadPane($) {
  return (await transportOf($)) === 'tmux' ? await $.env.get('TMUX_PANE') : await $.env.get('HERDR_PANE_ID')
}

// The worker panes this lead opened, one name per line, where the SessionEnd sweep reads them. Ownership is by
// name (agt-<run>-<role>, the run id is random), so a restarted lead takes its own panes back and no other.
export async function savePanes($) {
  const file = panesFile(S.home, await leadPane($))
  if (file) await $.fs.write(file, [...openedNames].map((n) => n + '\n').join('')).catch(() => {})
}

export async function loadOwned($) {
  const file = panesFile(S.home, await leadPane($))
  if (!file) return
  const text = await $.fs.read(file).catch(() => '')
  for (const n of String(text ?? '').split('\n')) if (splitName(n)) openedNames.add(n)
}

// A run tab herdr no longer lists is gone (its last pane closed): forget it.
export async function pruneTabs($, workspace) {
  if (!ownedTabs.size || !workspace) return
  const r = await $.process.run(herdrTabListArgv(workspace), PROBE).catch(() => null)
  const ids = r?.exitCode === 0 ? herdrTabIds(r.stdout) : null
  if (!ids) return
  const gone = [...ownedTabs].filter((t) => !ids.includes(t))
  for (const t of gone) ownedTabs.delete(t)
  if (gone.length) await saveTabs($)
}

// The lead's cwd and a pane's cwd are the same repo when they share a git common dir (a worktree does).
export async function sameRepo($, a, b) {
  if (a === b) return true
  const dir = async (d) => {
    const r = await $.process.run(['git', '-C', d, 'rev-parse', '--path-format=absolute', '--git-common-dir'], PROBE).catch(() => null)
    return r?.exitCode === 0 ? String(r.stdout).trim() : ''
  }
  const [x, y] = await Promise.all([dir(a), dir(b)])
  return !!x && x === y
}

// Whether the mod may accept the folder-trust prompt for `cwd` on the person's behalf. Sharing the lead's git
// common dir is not enough: a worktree of a contributor's branch can carry its own hooks, MCP servers, agents and
// commands, and a folder inside a checkout (a gitignored node_modules/<pkg>) can carry a .claude/ or .mcp.json of
// its own. Trusted: the lead's own cwd, the root of the lead's checkout, or the root of a worktree of the same repo
// on an agt/* branch that this lead's runs made, named by its exact path on the lead-<pane>.worktrees list (guard.js:
// JSON records with path and branch; a plain one-per-line list is read too; a branch name alone is not ownership),
// whose project config matches the lead checkout's (sameConfig). A folder below either root is never accepted. With
// no list nothing but the lead's own cwd and checkout root is accepted.
const OWN_BRANCH = /^agt\/[A-Za-z0-9._/-]+$/
// Absent in the worktree is fine for these (settings.local.json and CLAUDE.local.md are gitignored, so a fresh
// worktree has none); present, they must be the lead checkout's byte for byte.
const CONFIG_FILES = ['.mcp.json', '.claude/settings.json', '.claude/settings.local.json', 'CLAUDE.local.md']
// These must match both ways: absent on both sides, or the same bytes.
const MEMORY_FILES = ['CLAUDE.md', 'AGENTS.md', '.claude/CLAUDE.md']
const CONFIG_DIRS = ['.claude/agents', '.claude/commands', '.claude/skills', '.claude/hooks']
const TREE_MAX = 500
const REFS_MAX = 64
// The worktree paths a lead-<pane>.worktrees file names: the `path` of each JSON record (guard.js), or the absolute
// paths on a plain one-per-line list. Branch names are skipped: a branch can be checked out anywhere.
export function listedPaths(listed) {
  try {
    const recs = JSON.parse(listed)
    if (Array.isArray(recs)) return recs.filter((r) => r && typeof r.path === 'string' && r.path.startsWith('/')).map((r) => r.path)
  } catch {}
  return String(listed).split('\n').flatMap((l) => l.trim().split(/\s+/).filter((f) => f.startsWith('/')))
}
// Does the list name this worktree root `top` (as git prints it) by its exact path.
export function ownedWorktree(listed, top) {
  return listedPaths(listed).some((p) => p.replace(/\/+$/, '') === top)
}

// A file's text, ABSENT when there is none, UNREADABLE when it is there but cannot be read. Existence is asked of
// stat, the call that answers for files and folders alike.
const ABSENT = Symbol('absent')
const UNREADABLE = Symbol('unreadable')
async function missing($, path) {
  return $.fs.stat(path).then(() => false, () => true)
}
async function configFile($, path) {
  const text = await $.fs.read(path).catch(() => null)
  if (typeof text === 'string') return text
  return (await missing($, path)) ? ABSENT : UNREADABLE
}

// Every file under `dir` as relative path → text (empty for no dir), or null when any part cannot be read or the
// tree is too big to compare.
async function configTree($, dir) {
  const out = new Map()
  const walk = async (rel) => {
    const entries = await $.fs.list(rel ? dir + '/' + rel : dir).catch(() => null)
    if (!Array.isArray(entries)) return false
    for (const e of entries) {
      const path = rel ? rel + '/' + e.name : e.name
      if (e.kind === 'dir') {
        if (!(await walk(path))) return false
        continue
      }
      const text = await $.fs.read(dir + '/' + path).catch(() => null)
      if (typeof text !== 'string' || out.size >= TREE_MAX) return false
      out.set(path, text)
    }
    return true
  }
  if (await walk('')) return out
  return (await missing($, dir)) && out.size === 0 ? out : null
}

// The repo-relative files a command line may run: each word that is a path (holds a `/`) or names a script, with
// $CLAUDE_PROJECT_DIR (bare or braced) read as the checkout's root and an absolute path under `top` made relative.
// Other variables, `~` and absolute paths outside the checkout are the same file for both sides, so they are skipped.
// Over-reading is safe: a word that is no file is absent on both sides, and absent on both sides is equal.
const SCRIPT = /\.(?:sh|bash|zsh|fish|js|mjs|cjs|ts|mts|py|rb|pl|php|lua)$/i
export function commandPaths(command, top) {
  const out = []
  for (let w of String(command ?? '').split(/[\s;|&()<>=,]+/)) {
    w = w.replace(/^["'`]+|["'`]+$/g, '')
    const rooted = /^\$\{?CLAUDE_PROJECT_DIR\}?["']?(?=\/|$)/
    if (rooted.test(w)) w = w.replace(rooted, '').replace(/^\/+/, '')
    else if (w.startsWith(top + '/')) w = w.slice(top.length + 1)
    else if (w.startsWith('/')) continue
    if (!w || w.startsWith('-') || w.startsWith('~') || w.includes('$')) continue
    w = w.replace(/^(?:\.\/)+/, '')
    if (w && (w.includes('/') || SCRIPT.test(w))) out.push(w)
  }
  return out
}

// Every command string a settings file runs: hook commands and statusLine.command (any `command` key), and the
// helpers that run a command (apiKeyHelper, awsAuthRefresh, awsCredentialExport, otelHeadersHelper).
const HELPER_KEYS = new Set(['command', 'apiKeyHelper', 'awsAuthRefresh', 'awsCredentialExport', 'otelHeadersHelper'])
function settingsCommands(value, out = []) {
  if (Array.isArray(value)) for (const v of value) settingsCommands(v, out)
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (HELPER_KEYS.has(k) && typeof v === 'string') out.push(v)
      else settingsCommands(v, out)
    }
  }
  return out
}

// The command and args of every .mcp.json server.
function mcpCommands(json) {
  const servers = json && typeof json === 'object' ? json.mcpServers : null
  if (!servers || typeof servers !== 'object') return []
  return Object.values(servers).flatMap((v) => (v && typeof v === 'object' ? [v.command, ...(Array.isArray(v.args) ? v.args : [])] : [])).filter((x) => typeof x === 'string')
}

async function sameText($, a, b) {
  const [x, y] = await Promise.all([configFile($, a), configFile($, b)])
  return x !== UNREADABLE && y !== UNREADABLE && x === y
}
// A file a command names, or a folder (`--directory tools/mcp`, `cd apps/web`): a folder is compared file by file,
// and one too big to compare refuses.
async function sameEntry($, a, b) {
  const [x, y] = await Promise.all([configFile($, a), configFile($, b)])
  if (x !== UNREADABLE && y !== UNREADABLE) return x === y
  const [sa, sb] = await Promise.all([$.fs.stat(a).catch(() => null), $.fs.stat(b).catch(() => null)])
  if (sa?.kind !== 'dir' || sb?.kind !== 'dir') return false
  const [ta, tb] = await Promise.all([configTree($, a), configTree($, b)])
  if (!ta || !tb || ta.size !== tb.size) return false
  for (const [k, v] of ta) if (tb.get(k) !== v) return false
  return true
}

// The worktree brings no project config of its own: what it has is the lead checkout's, byte for byte. That is the
// .mcp.json, settings and local files (CONFIG_FILES, absent in the worktree is fine), CLAUDE.md, AGENTS.md and
// .claude/CLAUDE.md (MEMORY_FILES, absent on both sides or the same), .claude/agents, commands, skills and hooks
// (CONFIG_DIRS, every file, nested ones too), and every repo file a settings command or an .mcp.json server names
// (commandPaths): settings.json can stay byte for byte the same while the hook script it runs changes. A settings
// or .mcp.json file that does not parse refuses.
export async function sameConfig($, top, leadTop) {
  const mine = new Map()
  for (const f of CONFIG_FILES) {
    const text = await configFile($, top + '/' + f)
    if (text === ABSENT) continue
    if (text === UNREADABLE || text !== (await configFile($, leadTop + '/' + f))) return false
    mine.set(f, text)
  }
  for (const f of MEMORY_FILES) if (!(await sameText($, top + '/' + f, leadTop + '/' + f))) return false
  for (const d of CONFIG_DIRS) {
    const [here, lead] = await Promise.all([configTree($, top + '/' + d), configTree($, leadTop + '/' + d)])
    if (!here || !lead || here.size !== lead.size) return false
    for (const [k, v] of here) if (lead.get(k) !== v) return false
  }
  const commands = []
  try {
    for (const f of ['.claude/settings.json', '.claude/settings.local.json']) if (mine.has(f)) commands.push(...settingsCommands(JSON.parse(mine.get(f))))
    if (mine.has('.mcp.json')) commands.push(...mcpCommands(JSON.parse(mine.get('.mcp.json'))))
  } catch {
    return false
  }
  const refs = [...new Set(commands.flatMap((c) => commandPaths(c, top)))]
  if (refs.length > REFS_MAX) return false
  for (const r of refs) if (!(await sameEntry($, top + '/' + r, leadTop + '/' + r))) return false
  return true
}

// git's answer, trimmed, or null when git failed: '' is a real answer (--show-prefix at a checkout's root).
async function gitOut($, d, ...a) {
  const r = await $.process.run(['git', '-C', d, ...a], PROBE).catch(() => null)
  return r?.exitCode === 0 ? String(r.stdout ?? '').trim() : null
}
// A listed path that is not `top` letter for letter may still be it through a symlink (/tmp and /private/tmp): git
// resolves it. Only paths with top's own last segment are asked, so a long list costs nothing.
async function listsRoot($, listed, top) {
  if (ownedWorktree(listed, top)) return true
  const leaf = top.split('/').pop()
  for (const p of listedPaths(listed).filter((x) => x.replace(/\/+$/, '').split('/').pop() === leaf).slice(0, 8)) {
    const [real, prefix] = await Promise.all([gitOut($, p, 'rev-parse', '--show-toplevel'), gitOut($, p, 'rev-parse', '--show-prefix')])
    if (real === top && prefix === '') return true
  }
  return false
}

export async function trustable($, cwd, leadCwd) {
  if (cwd === leadCwd) return true
  if (!(await sameRepo($, cwd, leadCwd))) return false
  const [top, leadTop, prefix] = await Promise.all([gitOut($, cwd, 'rev-parse', '--show-toplevel'), gitOut($, leadCwd, 'rev-parse', '--show-toplevel'), gitOut($, cwd, 'rev-parse', '--show-prefix')])
  // A folder below a checkout's root brings whatever .claude/ or .mcp.json sits in it: never on the person's behalf.
  if (!top || !leadTop || prefix !== '') return false
  if (top === leadTop) return true
  const branch = await gitOut($, cwd, 'symbolic-ref', '--short', 'HEAD')
  if (!branch || !OWN_BRANCH.test(branch)) return false
  const file = String(panesFile(S.home, await leadPane($)) ?? '').replace(/\.panes$/, '.worktrees')
  const listed = file ? await $.fs.read(file).catch(() => null) : null
  if (typeof listed !== 'string' || !(await listsRoot($, listed, top))) return false
  return sameConfig($, top, leadTop)
}

// A fresh worker stopped on a startup screen (agent_not_ready): classify it, press the keys that clear it, up to
// 3 times. A trust prompt is accepted only where trustable says so; anything else throws and the pane is closed.
export async function clearDialogs($, name, cwd) {
  for (let i = 0; i < 3; i++) {
    const read = await $.process.run(herdrReadArgv(name), PROBE)
    const screen = String(read.stdout ?? '')
    const kind = startupDialog(screen)
    if (!kind) throw new Error(screenLine(screen))
    if (kind === 'trust' && !(await trustable($, cwd, await $.session.cwd()))) throw new Error(cwd + ' needs a one-time trust: open it once by hand.')
    const keys = dialogKeys(kind, screen)
    if (!keys.length) throw new Error(screenLine(screen))
    // One key at a time: a menu that has only just drawn drops keys sent in one burst.
    for (const k of keys) {
      await $.clock.sleep(300)
      await runOk($, herdrKeysArgv(name, [k]), PROBE)
    }
    // herdr reads the cleared screen about 0.5 s later; poll up to 10 s, then look for a next dialog.
    for (let n = 0; n < 20; n++) {
      await $.clock.sleep(500)
      const g = await $.process.run(herdrGetArgv(name), PROBE).catch(() => null)
      const status = g?.exitCode === 0 ? agentStatusOf(g.stdout) : null
      if (status === 'idle' || status === 'done') return
      if (status === 'blocked' && n >= 3) break
    }
  }
  throw new Error('startup dialogs did not clear after 3 tries')
}

export async function runOk($, argv, init) {
  const r = await $.process.run(argv, init)
  if (r.exitCode !== 0) throw new Error(argv.slice(0, 3).join(' ') + ' exited ' + r.exitCode + (r.stderr ? ': ' + String(r.stderr).trim().slice(0, 120) : ''))
  return r
}

// A fresh pane is busy while its shell starts up (a login banner, a slow rc): herdr says
// agent_pane_busy, so wait and try again for up to ~10s. A startup dialog is cleared.
export async function startAgent($, argv, name, cwd) {
  for (let attempt = 0; ; attempt++) {
    const r = await $.process.run(argv, HERDR_START_TIMEOUT)
    if (r.exitCode === 0) return
    if (/agent_not_ready/.test(r.stderr ?? '')) return clearDialogs($, name, cwd)
    if (!/agent_pane_busy/.test(r.stderr ?? '') || attempt >= 20) throw new Error('herdr agent start exited ' + r.exitCode + (r.stderr ? ': ' + String(r.stderr).trim().slice(0, 120) : ''))
    await $.clock.sleep(500)
  }
}

// One claude pane beside this one, named agt-<run>-<role>, never focused. A half-made
// pane is closed again before the error goes up. `split` stacks it beside an earlier worker
// instead of the lead; `newTab` opens a herdr run tab. Returns { id, tab }.
export async function openPane($, t, o) {
  if (t === 'tmux') {
    const lead = await $.env.get('TMUX_PANE')
    if (!lead) throw new Error('TMUX_PANE is not set')
    const target = o.split?.target ?? lead
    const shell = (await $.env.get('SHELL')) ?? ''
    const id = tmuxPaneIdOf((await runOk($, tmuxSplitArgv({ ...o, target, shell, direction: o.split?.direction, env: [...wireEnv({ name: o.name, lead: S.sessionId }), ...advisorEnv(o.model, S.settings)] }), PROBE)).stdout)
    if (!id) throw new Error('tmux gave no pane id')
    try {
      for (const argv of tmuxTagArgvs(id, o.name)) await runOk($, argv, PROBE)
    } catch (err) {
      await $.process.run(tmuxKillArgv(id), PROBE).catch(() => {})
      throw err
    }
    // Even out the stack; a cosmetic failure never loses the worker.
    if (o.split && o.split.target !== lead) await $.process.run(tmuxEvenArgv(id), PROBE).catch(() => {})
    return { id, tab: null }
  }
  const lead = await $.env.get('HERDR_PANE_ID')
  if (!lead) throw new Error('HERDR_PANE_ID is not set')
  const env = [...wireEnv({ name: o.name, lead: S.sessionId }), ...advisorEnv(o.model, S.settings)]
  let id
  let tab = o.split?.tab ?? null
  if (o.newTab) {
    const workspace = S.selfWorkspace ?? (await $.env.get('HERDR_WORKSPACE_ID'))
    if (!workspace) throw new Error('HERDR_WORKSPACE_ID is not set')
    const made = herdrTabOf((await runOk($, herdrTabArgv({ workspace, cwd: o.cwd, run: o.run, agent: o.agent, model: o.model, effort: o.effort, env }), PROBE)).stdout)
    if (!made) throw new Error('herdr gave no tab id')
    id = made.pane
    tab = made.tab
    ownedTabs.add(tab)
    await saveTabs($)
  } else {
    const pane = o.split?.target ?? lead
    id = herdrPaneIdOf((await runOk($, herdrSplitArgv({ pane, cwd: o.cwd, run: o.run, direction: o.split?.direction, agent: o.agent, model: o.model, effort: o.effort, env }), PROBE)).stdout)
    if (!id) throw new Error('herdr gave no pane id')
  }
  try {
    await startAgent($, herdrStartArgv({ name: o.name, pane: id, model: o.model, effort: o.effort, agent: o.agent, vendor: o.vendor }), o.name, o.cwd)
    // Codex has no pane tools of ours: it saves its answer where the harvest, reaper and wake paths look.
    const task = o.vendor === 'codex' ? codexTask(o.task, answerFile(S.home, o.run, splitName(o.name).role, paneKey(id))) : o.task
    await runOk($, herdrPromptArgv(o.name, task), PROBE)
  } catch (err) {
    await $.process.run(herdrCloseArgv(id), PROBE).catch(() => {})
    if (o.newTab) {
      ownedTabs.delete(tab) // a run tab's only pane closing takes the tab with it
      await saveTabs($)
    }
    throw err
  }
  // Herdr's sidebar names the worker by role and route; cosmetic, so a failure is ignored.
  const meta = herdrMetaArgv(id, { display: '▣ ' + shortName(o.name) + ' · ' + o.model })
  if (meta) await $.process.run(meta, PROBE).catch(() => {})
  return { id, tab }
}

// The pane tools exist only once the person typed for them, so a plain session carries no spawn_pane or
// open_sessions in its tool list: a typed /agt registers spawn_pane, a typed ask for sessions registers
// open_sessions, and close_pane comes with whichever came first. A worker pane gets no fan-out of its own,
// and a host without a pane transport gets none. A tool registered while a prompt is submitted is in that
// turn's list.
export async function ensureTools($, which) {
  if (!isLead() || S.hostOld) return
  if ((which === 'panes' ? S.paneTools : S.sessionTools) || (await transportOf($)) === 'none') return
  try {
    await $.tool.register(which === 'panes' ? SPAWN_TOOL : OPEN_SESSIONS_TOOL)
    if (!S.closeTool) {
      await $.tool.register(CLOSE_TOOL)
      S.closeTool = true
    }
    if (which === 'panes') S.paneTools = true
    else S.sessionTools = true
  } catch {
    // an older host without $.tool.register: /agt runs its heavy level as subagent waves
  }
}
