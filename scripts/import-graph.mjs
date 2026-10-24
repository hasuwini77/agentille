#!/usr/bin/env node
// The import graph among hooks/*.js and its strongly connected components (Tarjan). A component of more than one
// module is an import cycle. Prints each module's local imports with --graph, else one line per cycle:
//   CYCLE a.js b.js c.js   (members, sorted)   then   PATH a.js > b.js > c.js > a.js   (one cycle through them)
// --check [allowed]: exits 1 when a cycle exists whose sorted members, joined by ',', are not in the comma-and-space
// list `allowed` (e.g. "a.js,b.js c.js,d.js"). Run from the repo root, or pass --dir <hooks dir>.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const argv = process.argv.slice(2)
const opt = (k) => { const i = argv.indexOf(k); return i < 0 ? null : (argv[i + 1] ?? '') }
const dir = opt('--dir') ?? 'hooks'

// import/export … from './x.js' (one line or several), import './x.js', and import('./x.js'); line comments dropped.
const spec = /^\s*(?:import|export)\b[^;'"]*?\bfrom\s*['"]\.\/([^'"]+)['"]|^\s*import\s*['"]\.\/([^'"]+)['"]|\bimport\s*\(\s*['"]\.\/([^'"]+)['"]/gm
const deps = (f) => {
  const t = readFileSync(join(dir, f), 'utf8').replace(/^\s*\/\/.*$/gm, '')
  return [...new Set([...t.matchAll(spec)].map((m) => m[1] ?? m[2] ?? m[3]))]
}
const files = readdirSync(dir).filter((f) => f.endsWith('.js')).sort()
const g = Object.fromEntries(files.map((f) => [f, deps(f).filter((d) => files.includes(d))]))

// Tarjan's strongly connected components.
const index = new Map(), low = new Map(), on = new Set(), stack = [], sccs = []
let n = 0
const visit = (v) => {
  index.set(v, n); low.set(v, n); n++
  stack.push(v); on.add(v)
  for (const w of g[v]) {
    if (!index.has(w)) { visit(w); low.set(v, Math.min(low.get(v), low.get(w))) }
    else if (on.has(w)) low.set(v, Math.min(low.get(v), index.get(w)))
  }
  if (low.get(v) === index.get(v)) {
    const c = []
    let w
    do { w = stack.pop(); on.delete(w); c.push(w) } while (w !== v)
    sccs.push(c.sort())
  }
}
for (const f of files) if (!index.has(f)) visit(f)
const cycles = sccs.filter((c) => c.length > 1 || g[c[0]].includes(c[0]))

// One concrete cycle through a component: the shortest way back from its first member, inside the component.
const pathIn = (c) => {
  const inC = new Set(c), start = c[0], prev = new Map([[start, null]]), todo = [start]
  while (todo.length) {
    const m = todo.shift()
    for (const w of g[m]) {
      if (!inC.has(w)) continue
      if (w === start) {
        const out = [m]
        while (prev.get(out[out.length - 1]) !== null) out.push(prev.get(out[out.length - 1]))
        return [...out.reverse(), start].join(' > ')
      }
      if (!prev.has(w)) { prev.set(w, m); todo.push(w) }
    }
  }
  return start
}

if (argv.includes('--graph')) for (const f of files) console.log(f + ': ' + g[f].join(' '))
const allowed = new Set((opt('--check') ?? '').split(/\s+/).filter(Boolean))
let bad = 0
for (const c of cycles) {
  const ok = allowed.has(c.join(','))
  if (!ok) bad++
  console.log((ok ? 'ALLOWED ' : 'CYCLE ') + c.join(' '))
  console.log('PATH ' + pathIn(c))
}
if (!cycles.length) console.log('NONE ' + files.length + ' modules, no import cycle')
if (argv.includes('--check') && bad) process.exit(1)
