// agentille guard: the gh and curl/wget step readers. A gh or HTTP command line's words → the integration
// candidate it is (a merge, a release, an API write that merges, writes a ref or a release), or null. A leaf: it
// imports nothing, so the lexer (guard-lex.js) and the policy (guard-policy.js) can both use it with no cycle.

// A program word's last path segment: `/usr/bin/git` → `git`.
export const base = (w) => String(w ?? '').split('/').pop()

// ── which commands integrate ─────────────────────────────────────────────────
// Each candidate: { kind: 'step' (merge, tag, release: auto only) | 'push' (judged) | 'pr' (refused under
// local), what, dir (where it runs; null when a variable names it), slug (a repo it names: owner/repo or a URL) }.
const API_WRITES = new Set(['merge', 'merges', 'merge-upstream', 'releases'])

const API_WRITE_PATH = /^repos\/[^/]+\/[^/]+\/(git\/refs|git\/tags|contents)(\/|$)/

const MUTATION = /\b(mergePullRequest|enablePullRequestAutoMerge|enqueuePullRequest|createRelease|updateRelease|deleteRelease|createRef|updateRef|updateRefs|deleteRef|mergeBranch|createCommitOnBranch)\b/

// A GraphQL body that writes a merge, a ref or a release; or one the guard cannot read (a file, a variable).
const GQL_WRITE = /\bmutation\b[\s\S]*(merge|ref|release|tag|commitonbranch)/i

const gqlWrites = (body) => MUTATION.test(body) || GQL_WRITE.test(body)

const gqlUnread = (field) => /^query=(@|\$)/.test(field)

const apiSlug = (path) => {
  const m = /^repos\/([^/]+)\/([^/]+)/.exec(path)
  return m && !m[1].startsWith('{') && !m[2].startsWith('{') ? m[1] + '/' + m[2] : null
}

// Writes that change what guards the base branch or start a workflow: branch protection, rulesets, a workflow's
// dispatch, enable or disable.
const API_GUARD_PATH = /^repos\/[^/]+\/[^/]+\/(branches\/.+\/protection|rulesets|actions\/workflows\/[^/]+\/(dispatches|enable|disable))(\/|$)/

const sensitive = (path) => path.split('/').some((s) => API_WRITES.has(s)) || API_WRITE_PATH.test(path) || API_GUARD_PATH.test(path)

// A write to the repo itself (`repos/o/r`) that sets its default branch, or whose body the guard cannot read.
const repoRoot = (path) => /^repos\/[^/]+\/[^/]+\/?$/.test(path)
const setsDefault = (bodies, unread) => unread || bodies.some((b) => /default_branch/.test(b) || /^[@$]/.test(b))


// `env`: what the line set in front of gh; GH_REPO (or GITHUB_REPOSITORY) names its repo as -R does.
export function ghStep(w, dir, env = new Map()) {
  const args = w.slice(1)
  let slug = env.get('GH_REPO') || env.get('GITHUB_REPOSITORY') || null
  const pos = []
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a === '-R' || a === '--repo') slug = args[++i] ?? null
    else if (a.startsWith('--repo=')) slug = a.slice(7)
    else if (/^-R./.test(a)) slug = a.slice(2)
    else pos.push(a)
  }
  const [a0, a1] = pos.filter((x) => !x.startsWith('-'))
  if (a0 === 'pr' && a1 === 'merge') return { kind: 'step', what: 'gh pr merge', dir, slug }
  if (a0 === 'release' && a1 && !['list', 'ls', 'view', 'download', 'verify', 'verify-asset'].includes(a1)) return { kind: 'step', what: 'gh release ' + a1, dir, slug }
  if (a0 === 'pr' && a1 === 'create') return { kind: 'pr', what: 'gh pr create', dir, slug }
  // An alias can name any of the above under a new word: making one is a step of its own.
  if (a0 === 'alias' && !['list', 'ls'].includes(a1)) return { kind: 'step', what: 'gh alias ' + (a1 ?? ''), dir, slug }
  // A workflow run can publish or merge on the run's behalf; enabling or disabling one changes what guards the base.
  if (a0 === 'workflow' && ['run', 'enable', 'disable'].includes(a1)) return { kind: 'step', what: 'gh workflow ' + a1, dir, slug }
  if (a0 === 'repo' && a1 === 'edit' && pos.some((x) => x === '--default-branch' || x.startsWith('--default-branch='))) return { kind: 'step', what: 'gh repo edit --default-branch', dir, slug }
  if (a0 !== 'api') return null
  let method = null
  let body = false
  let input = false
  let endpoint = null
  const fields = []
  for (let i = pos.indexOf('api') + 1; i < pos.length; i++) {
    const a = pos[i]
    if (a === '-X' || a === '--method') method = pos[++i] ?? null
    else if (/^-X./.test(a)) method = a.slice(2)
    else if (a.startsWith('--method=')) method = a.slice(9)
    else if (['-f', '-F', '--field', '--raw-field'].includes(a)) { body = true; fields.push(pos[++i] ?? '') }
    else if (/^-[fF]./.test(a) || a.startsWith('--field=') || a.startsWith('--raw-field=')) { body = true; fields.push(a.replace(/^(-[fF]|--(raw-)?field=)/, '')) }
    else if (a === '--input' || a.startsWith('--input=')) { body = true; input = true; if (a === '--input') i++ }
    else if (['-H', '--header', '-q', '--jq', '-t', '--template', '--hostname', '--cache', '-p', '--preview'].includes(a)) i++
    else if (a.startsWith('-')) continue
    else if (endpoint === null) endpoint = a
  }
  const m = String(method ?? (body ? 'POST' : 'GET')).toUpperCase()
  const path = String(endpoint ?? '').replace(/^\//, '').split('?')[0]
  if (m === 'GET') return null
  if (path === 'graphql') return fields.some((f) => gqlWrites(f) || gqlUnread(f)) || input ? { kind: 'step', what: 'gh api graphql mutation', dir, slug } : null
  if (repoRoot(path) && setsDefault(fields, input)) return { kind: 'step', what: 'gh api ' + m + ' ' + path + ' default_branch', dir, slug: apiSlug(path) ?? slug }
  return sensitive(path) ? { kind: 'step', what: 'gh api ' + m + ' ' + path, dir, slug: apiSlug(path) ?? slug } : null
}


// curl's one-letter options that take a value.
const CURL_SHORT_VALUE = 'AbcCdDeEFHKmoPQrtTuUwxXyYz'


// curl / wget straight at the GitHub API (api.github.com, uploads.github.com, a GHE …/api/v3/).
export function httpStep(w, dir) {
  const p = base(w[0])
  let method = null
  let body = false
  let get = false
  const data = []
  const urls = []
  const VAL = p === 'curl'
    ? ['-H', '--header', '-o', '--output', '-u', '--user', '-A', '--user-agent', '-e', '--referer', '-b', '--cookie', '-c', '--cookie-jar', '-w', '--write-out', '-m', '--max-time', '--connect-timeout', '-x', '--proxy', '--retry', '-K', '--config', '--cacert', '--cert', '--key', '-E']
    : ['-O', '--output-document', '-o', '--output-file', '--header', '-U', '--user-agent', '--user', '--password', '-t', '--tries', '-T', '--timeout', '-P', '--directory-prefix']
  for (let i = 1; i < w.length; i++) {
    const a = w[i]
    const eq = a.startsWith('--') ? a.indexOf('=') : -1
    const k = eq > 0 ? a.slice(0, eq) : a
    const v = () => (eq > 0 ? a.slice(eq + 1) : w[++i] ?? '')
    if (p === 'curl' && /^-[^-]/.test(a)) {
      // A cluster of short flags (-sSfX PUT, -sXPUT, -sd@body): a letter that takes a value ends it.
      for (let j = 1; j < a.length; j++) {
        const ch = a[j]
        if (ch === 'G' || ch === 'I') get = true
        if (!CURL_SHORT_VALUE.includes(ch)) continue
        const val = j + 1 < a.length ? a.slice(j + 1) : w[++i] ?? ''
        if (ch === 'X') method = val
        else if ('dFT'.includes(ch)) { body = true; data.push(val) }
        break
      }
    } else if (p === 'curl' && k === '--request') method = v()
    else if (p === 'curl' && k === '--get') get = true
    else if (p === 'curl' && (/^--data/.test(k) || ['--json', '--form', '--form-string', '--upload-file'].includes(k))) { body = true; data.push(v()) }
    else if (p !== 'curl' && k === '--method') method = v()
    else if (p !== 'curl' && ['--post-data', '--post-file', '--body-data', '--body-file'].includes(k)) { body = true; data.push(v()) }
    else if (VAL.includes(k)) { if (eq < 0) i++ }
    else if (!a.startsWith('-')) urls.push(a)
  }
  const m = get ? 'GET' : String(method ?? (body ? 'POST' : 'GET')).toUpperCase()
  if (m === 'GET') return null
  for (const u of urls) {
    const s = u.replace(/^[a-z]+:\/\//i, '').split(/[?#]/)[0]
    const host = s.split('/')[0].toLowerCase()
    const rest = s.slice(host.length + 1)
    const path = host === 'api.github.com' || host === 'uploads.github.com' ? rest : rest.includes('api/v3/') ? rest.slice(rest.indexOf('api/v3/') + 7) : rest.startsWith('api/graphql') ? 'graphql' : null
    if (path === null) continue
    if (path.replace(/\/$/, '') === 'graphql') {
      if (data.some((d) => gqlWrites(d) || d.startsWith('@') || /^\$/.test(d))) return { kind: 'step', what: p + ' graphql mutation', dir, slug: null }
    } else if (sensitive(path) || host === 'uploads.github.com' || (repoRoot(path) && setsDefault(data, false))) return { kind: 'step', what: p + ' ' + m + ' ' + path, dir, slug: apiSlug(path) }
  }
  return null
}
