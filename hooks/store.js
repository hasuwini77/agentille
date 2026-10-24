// agentille stores: each part of session state lives in the module that writes it. makeStore gives that module
// the record it writes (`s`) and a read view for everyone else (`view`): the view reads the live record, and any
// assignment, delete or defineProperty on it throws, naming the owner whose transitions make the change. The view
// is shallow: a Map, Set or array it holds is the owner's own object, changed only through the owner's transitions.
// A leaf: it imports nothing, so every owner can make its store at load time.

const records = new WeakMap() // view → its record, for seed()

export function makeStore(owner, fields) {
  const s = fields
  const deny = (k) => {
    throw new TypeError(String(k) + ' is read-only here: ' + owner + ' writes it through its transitions')
  }
  const view = new Proxy(s, {
    set: (_, k) => deny(k),
    deleteProperty: (_, k) => deny(k),
    defineProperty: (_, k) => deny(k),
    setPrototypeOf: () => deny('the prototype'),
    preventExtensions: () => false,
  })
  records.set(view, s)
  return { s, view }
}

// Tests only: write fields on a store past its transitions (to set up a case and put it back after). The mod's
// own code never calls this; scripts/validate.sh fails a hooks/*.js that does.
export function seed(view, fields) {
  const s = records.get(view)
  if (!s) throw new TypeError('seed: not a store view')
  const was = {}
  for (const k of Object.keys(fields)) was[k] = s[k]
  Object.assign(s, fields)
  return was
}
