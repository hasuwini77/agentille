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
// A repository_dispatch (repos/o/r/dispatches) starts workflows as a workflow dispatch does.
const API_GUARD_PATH = /^repos\/[^/]+\/[^/]+\/(branches\/.+\/protection|rulesets|dispatches|actions\/workflows\/[^/]+\/(dispatches|enable|disable))(\/|$)/

// Repo writes that publish or destroy, which only `auto` (or the person) makes: a collaborator added, a secret or
// variable set, the repo deleted or transferred, merge settings changed. → the label, or null.
const REPO_SETTINGS = /\b(allow_auto_merge|delete_branch_on_merge|archived|allow_squash_merge|allow_merge_commit|allow_rebase_merge|visibility|private)\b/
export function apiPublish(m, path, bodies = [], unread = false) {
  const p = String(path ?? '').replace(/^\//, '').replace(/\/$/, '')
  if (m === 'GET' || m === 'HEAD') return null
  if (/^repos\/[^/]+\/[^/]+\/collaborators\/[^/]+$/.test(p) && m === 'PUT') return 'a collaborator added'
  if (/^repos\/[^/]+\/[^/]+\/(actions|dependabot|codespaces)\/(secrets|variables)(\/|$)/.test(p) || /^(orgs\/[^/]+|user)\/(actions\/)?(secrets|variables)(\/|$)/.test(p)) return 'a secret or variable written'
  if (/^repos\/[^/]+\/[^/]+\/transfer$/.test(p)) return 'a repo transfer'
  if (/^repos\/[^/]+\/[^/]+$/.test(p) && m === 'DELETE') return 'a repo deletion'
  if (/^repos\/[^/]+\/[^/]+$/.test(p) && (unread || bodies.some((b) => REPO_SETTINGS.test(b)))) return 'a change to the repo settings'
  return null
}

const sensitive = (path) => path.split('/').some((s) => API_WRITES.has(s)) || API_WRITE_PATH.test(path) || API_GUARD_PATH.test(path)

// A write to the repo itself (`repos/o/r`) that sets its default branch, or whose body the guard cannot read.
const repoRoot = (path) => /^repos\/[^/]+\/[^/]+\/?$/.test(path)
const setsDefault = (bodies, unread) => unread || bodies.some((b) => /default_branch/.test(b) || /^[@$]/.test(b))


// gh's own commands: any other first word is an alias from gh's config, an extension or a typo.
const GH_COMMANDS = new Set(('accessibility agent-task alias api attestation auth browse cache co codespace completion config copilot ' +
  'extension gist gpg-key help issue label org pr preview project release repo ruleset run search secret ssh-key status variable ' +
  'version workflow').split(' '))

const AUTO_MERGE_LABEL = /auto-?merge/i

// The labels `--add-label` adds (repeated, or comma-separated).
function labels(pos) {
  const out = []
  for (let i = 0; i < pos.length; i++) {
    if (pos[i] === '--add-label') out.push(...String(pos[++i] ?? '').split(','))
    else if (pos[i].startsWith('--add-label=')) out.push(...pos[i].slice(12).split(','))
  }
  return out
}

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
  // A word that is none of gh's own commands may be an alias from gh's config: guardLine reads and judges it.
  if (a0 !== undefined && !GH_COMMANDS.has(a0) && !/[$`]/.test(a0)) return { kind: 'ghalias', what: 'gh ' + a0, sub: a0, args: pos.slice(pos.indexOf(a0) + 1), dir, slug }
  if (a0 === 'pr' && a1 === 'merge') return { kind: 'step', what: 'gh pr merge', dir, slug }
  // An approval can satisfy the review the base requires; an auto-merge label can merge on a bot's behalf.
  if (a0 === 'pr' && a1 === 'review' && pos.some((x) => x === '--approve' || x === '-a' || /^-[a-zA-Z]*a$/.test(x))) return { kind: 'step', what: 'gh pr review --approve', dir, slug }
  if (a0 === 'pr' && a1 === 'edit' && labels(pos).some((l) => AUTO_MERGE_LABEL.test(l))) return { kind: 'step', what: 'gh pr edit --add-label (an auto-merge label)', dir, slug }
  // gh repo sync writes a branch (the default branch unless -b names another) from its upstream.
  if (a0 === 'repo' && a1 === 'sync') return { kind: 'step', what: 'gh repo sync', dir, slug }
  if (a0 === 'release' && a1 && !['list', 'ls', 'view', 'download', 'verify', 'verify-asset'].includes(a1)) return { kind: 'step', what: 'gh release ' + a1, dir, slug }
  if (a0 === 'pr' && a1 === 'create') return { kind: 'pr', what: 'gh pr create', dir, slug }
  // An alias can name any of the above under a new word: making one is a step of its own.
  if (a0 === 'alias' && !['list', 'ls'].includes(a1)) return { kind: 'step', what: 'gh alias ' + (a1 ?? ''), dir, slug }
  // A workflow run can publish or merge on the run's behalf; enabling or disabling one changes what guards the base.
  if (a0 === 'workflow' && ['run', 'enable', 'disable'].includes(a1)) return { kind: 'step', what: 'gh workflow ' + a1, dir, slug }
  if (a0 === 'repo' && a1 === 'edit' && pos.some((x) => x === '--default-branch' || x.startsWith('--default-branch='))) return { kind: 'step', what: 'gh repo edit --default-branch', dir, slug }
  // Destructive or publishing repo changes: only `auto`, or the person.
  if (a0 === 'repo' && ['delete', 'archive', 'unarchive', 'rename', 'transfer'].includes(a1)) return { kind: 'publish', what: 'gh repo ' + a1, dir, slug }
  if (a0 === 'repo' && a1 === 'edit' && pos.some((x) => /^--(enable-auto-merge|delete-branch-on-merge|visibility|enable-merge-commit|enable-squash-merge|enable-rebase-merge)/.test(x))) return { kind: 'publish', what: 'gh repo edit (merge settings or visibility)', dir, slug }
  if ((a0 === 'secret' && ['set', 'delete', 'remove'].includes(a1)) || (a0 === 'variable' && ['set', 'delete', 'remove'].includes(a1))) return { kind: 'publish', what: 'gh ' + a0 + ' ' + a1, dir, slug }
  if (a0 === 'ruleset' && a1 && !['list', 'ls', 'view', 'check'].includes(a1)) return { kind: 'publish', what: 'gh ruleset ' + a1, dir, slug }
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
  const pub = apiPublish(m, path, fields, input)
  if (pub) return { kind: 'publish', what: 'gh api ' + m + ' ' + path + ' (' + pub + ')', dir, slug: apiSlug(path) ?? slug }
  return sensitive(path) ? { kind: 'step', what: 'gh api ' + m + ' ' + path, dir, slug: apiSlug(path) ?? slug } : null
}


// curl's one-letter options that take a value.
const CURL_SHORT_VALUE = 'AbcCdDeEFHKmoPQrtTuUwxXyYz'


// curl / wget / httpie (http, https, xh, xhs) straight at the GitHub API (api.github.com, uploads.github.com, a GHE
// …/api/v3/).
export const HTTPIE = new Set(['http', 'https', 'xh', 'xhs'])

export function httpStep(w, dir) {
  const p = base(w[0])
  if (HTTPIE.has(p)) return httpieStep(w, dir)
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
  return githubWrite(p, m, urls, data, dir)
}

// httpie and xh: `http [flags] [METHOD] URL [items]`. An item `k=v`, `k:=json` or `k@file` is a body (POST by
// default); `k==v` is a query and `Header:v` a header.
const HTTPIE_VALUE = new Set(['-a', '--auth', '-A', '--auth-type', '-o', '--output', '--session', '--session-read-only', '--cert', '--cert-key', '--verify', '--timeout', '--proxy', '--max-redirects', '-p', '--print', '--pretty', '-s', '--style', '--format-options', '--response-charset', '--response-mime'])
function httpieStep(w, dir) {
  const p = base(w[0])
  const pos = []
  let form = false
  for (let i = 1; i < w.length; i++) {
    const a = w[i]
    if (HTTPIE_VALUE.has(a)) i++
    else if (a === '-f' || a === '--form' || a === '--multipart') form = true
    else if (!a.startsWith('-') || a === '-') pos.push(a)
  }
  let method = null
  if (pos.length && /^[A-Za-z]+$/.test(pos[0]) && /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/i.test(pos[0]) && pos.length > 1) method = pos.shift()
  const url = pos.shift() ?? ''
  const data = pos.filter((x) => /^[^=:@]+(:=@?|=@?|@)/.test(x) && !/^[^=]+==/.test(x))
  const m = String(method ?? (data.length || form ? 'POST' : 'GET')).toUpperCase()
  return githubWrite(p, m, [url], data, dir)
}

// A write (any method but GET) to one of the URLs, judged by its GitHub API path.
function githubWrite(p, m, urls, data, dir) {
  if (m === 'GET' || m === 'HEAD' || m === 'OPTIONS') return null
  for (const u of urls) {
    const s = u.replace(/^[a-z]+:\/\//i, '').split(/[?#]/)[0]
    const host = s.split('/')[0].toLowerCase()
    const rest = s.slice(host.length + 1)
    const path = host === 'api.github.com' || host === 'uploads.github.com' ? rest : rest.includes('api/v3/') ? rest.slice(rest.indexOf('api/v3/') + 7) : rest.startsWith('api/graphql') ? 'graphql' : null
    if (path === null) continue
    if (path.replace(/\/$/, '') === 'graphql') {
      if (data.some((d) => gqlWrites(d) || d.startsWith('@') || /^\$/.test(d))) return { kind: 'step', what: p + ' graphql mutation', dir, slug: null }
    } else if (sensitive(path) || host === 'uploads.github.com' || (repoRoot(path) && setsDefault(data, false))) return { kind: 'step', what: p + ' ' + m + ' ' + path, dir, slug: apiSlug(path) }
    else if (apiPublish(m, path, data, data.some((d) => /^[@$]/.test(d)))) return { kind: 'publish', what: p + ' ' + m + ' ' + path + ' (' + apiPublish(m, path, data, data.some((d) => /^[@$]/.test(d))) + ')', dir, slug: apiSlug(path) }
  }
  return null
}
