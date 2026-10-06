/** One in-memory AbortController per routing request, so cancel can stop a call without Clef. */
export type RoutingAbortRegistry = {
  /** Null when this request is already routing, which makes a racing second router a no-op. */
  begin(requestId: string): AbortController | null
  /** Frees the slot only if it still holds this run's controller. */
  end(requestId: string, controller: AbortController): void
  /** True when a routing run was in flight for the request. */
  abort(requestId: string): boolean
  abortAll(): number
  has(requestId: string): boolean
}

export function createRoutingAbortRegistry(): RoutingAbortRegistry {
  const controllers = new Map<string, AbortController>()
  return {
    begin(requestId) {
      if (controllers.has(requestId)) {
        return null
      }
      const controller = new AbortController()
      controllers.set(requestId, controller)
      return controller
    },
    end(requestId, controller) {
      if (controllers.get(requestId) === controller) {
        controllers.delete(requestId)
      }
    },
    abort(requestId) {
      const controller = controllers.get(requestId)
      controller?.abort()
      return controller !== undefined
    },
    abortAll() {
      const running = [...controllers.values()]
      for (const controller of running) {
        controller.abort()
      }
      return running.length
    },
    has(requestId) {
      return controllers.has(requestId)
    }
  }
}
