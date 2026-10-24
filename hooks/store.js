// agentille stores: each part of session state lives in the module that writes it. makeStore gives that module
// the record it writes (`s`) and a read view for everyone else (`view`): the view reads the live record, and any
// assignment, delete or defineProperty on it throws, naming the owner whose transitions make the change. The view
// is deep: a plain object or array it holds reads through a view of its own, and a Map or Set answers get, has,
// size and iteration but throws on set, add, delete and clear. Each object has one view, so a value read twice is
// the same value. `raw` hands the owner back its own object for a view it is given (a record a caller read through
// the view), so the owner's lookups by identity and its own writes keep working.
// A leaf: it imports nothing, so every owner can make its store at load time.

const records = new WeakMap() // view → its record, for seed()
const targets = new WeakMap() // any view, top-level or nested → the object it reads, for seed()

const isPlain = (v) => {
  const p = Object.getPrototypeOf(v)
  return p === Object.prototype || p === null
}
// Only plain objects, arrays, Maps and Sets read through a view: a Date, a function or a class instance is handed
// out as it is.
const viewable = (v) => v !== null && typeof v === 'object' && (Array.isArray(v) || v instanceof Map || v instanceof Set || isPlain(v))

const COLLECTION_WRITES = new Set(['set', 'add', 'delete', 'clear'])

export function makeStore(owner, fields) {
  const s = fields
  const deny = (k) => {
    throw new TypeError(String(k) + ' is read-only here: ' + owner + ' writes it through its transitions')
  }
  const views = new WeakMap() // object → its view
  const mine = new WeakMap() // this store's views → their objects, for raw()

  const wrap = (v) => {
    if (!viewable(v)) return v
    let p = views.get(v)
    if (!p) {
      p = new Proxy(v, v instanceof Map || v instanceof Set ? collection(v) : plain)
      views.set(v, p)
      mine.set(p, v)
      targets.set(p, v)
    }
    return p
  }

  const locked = {
    set: (_, k) => deny(k),
    deleteProperty: (_, k) => deny(k),
    defineProperty: (_, k) => deny(k),
    setPrototypeOf: () => deny('the prototype'),
    preventExtensions: () => false,
  }

  const plain = {
    ...locked,
    get(t, k, r) {
      const v = Reflect.get(t, k, r)
      if (!viewable(v)) return v
      // A frozen field must read as itself (a Proxy invariant): it cannot be written anyway.
      const d = Reflect.getOwnPropertyDescriptor(t, k)
      if (d && !d.configurable && !d.writable) return v
      return wrap(v)
    },
  }

  // A Map's or Set's methods need the real object as `this`: reads are bound to it and hand out views, writes throw.
  const collection = (t) => {
    const isMap = t instanceof Map
    const pair = ([k, v]) => [wrap(k), wrap(v)]
    function* each(kind) {
      if (kind === 'keys' || (!isMap && kind !== 'entries')) for (const v of t.keys()) yield wrap(v)
      else if (kind === 'values') for (const v of t.values()) yield wrap(v)
      else for (const e of t.entries()) yield pair(e)
    }
    return {
      ...locked,
      get(_, k, r) {
        if (k === 'size') return t.size
        if (typeof k === 'string' && COLLECTION_WRITES.has(k)) return () => deny(k)
        if (k === 'get') return (key) => wrap(t.get(key))
        if (k === 'has') return (key) => t.has(key)
        if (k === 'keys' || k === 'values' || k === 'entries') return () => each(k)
        if (k === Symbol.iterator) return () => each(isMap ? 'entries' : 'values')
        if (k === 'forEach') return (fn, self) => t.forEach((v, key) => fn.call(self, wrap(v), wrap(key), r))
        const v = Reflect.get(t, k, t)
        return typeof v === 'function' ? v.bind(t) : v
      },
    }
  }

  const view = wrap(s)
  records.set(view, s)
  const raw = (v) => mine.get(v) ?? v
  return { s, view, raw }
}

// A value handed to seed() may hold views (a test's copy made with `new Map(Runs.live)` or `[...Runs.decisions]`):
// the record gets the objects behind them, so the owner's own writes keep working after a test puts it back.
function unview(v, depth = 0) {
  const t = targets.get(v)
  if (t) return t
  if (depth > 4 || v === null || typeof v !== 'object') return v
  if (Array.isArray(v)) return v.map((x) => unview(x, depth + 1))
  if (v instanceof Map) return new Map([...v].map(([k, x]) => [unview(k, depth + 1), unview(x, depth + 1)]))
  if (v instanceof Set) return new Set([...v].map((x) => unview(x, depth + 1)))
  if (isPlain(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, unview(x, depth + 1)]))
  return v
}

// Tests only: write fields on a store past its transitions (to set up a case and put it back after). The mod's
// own code never calls this; scripts/validate.sh fails a hooks/*.js that does.
export function seed(view, fields) {
  const s = records.get(view)
  if (!s) throw new TypeError('seed: not a store view')
  const was = {}
  for (const k of Object.keys(fields)) was[k] = s[k]
  for (const k of Object.keys(fields)) s[k] = unview(fields[k])
  return was
}
