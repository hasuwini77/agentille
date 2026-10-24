// agentille bus: the transitions one owner calls on a peer it does not import. A leaf (it imports nothing): the
// owner registers its transition once as it loads (`on`), and the caller reaches it at call time (`emit`), so the
// two modules never import each other and no module reads a peer at load time. A handler runs synchronously and
// what it throws reaches the caller, as a direct call would. With no owner loaded, an emit does nothing.

const handlers = new Map()

export function on(event, fn) {
  if (!handlers.has(event)) handlers.set(event, [])
  handlers.get(event).push(fn)
}

export function emit(event, payload) {
  for (const fn of handlers.get(event) ?? []) fn(payload)
}
