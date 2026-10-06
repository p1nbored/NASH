// FIXTURE_ONLY: the fake Site's event fold: duplicates by id, stale by revision, one cursor per request.
import {
  DotRemoteEventBatchSchema,
  type DotRemoteEvent
} from '../../../shared/dot-remote/dot-remote-events'

export function createFakeEventFold() {
  const events: DotRemoteEvent[] = []
  const applied = new Map<string, number>()

  /** The response body of one events.post batch. */
  function post(body: unknown) {
    const batch = DotRemoteEventBatchSchema.parse(body)
    const results = batch.events.map((event) => {
      const seen = events.find((entry) => entry.eventId === event.eventId)
      if (seen) {
        return { eventId: event.eventId, status: 'duplicate' }
      }
      events.push(event)
      if (event.sourceRevision <= (applied.get(event.dotRequestId) ?? 0)) {
        return { eventId: event.eventId, status: 'stale' }
      }
      applied.set(event.dotRequestId, event.sourceRevision)
      return { eventId: event.eventId, status: 'applied' }
    })
    const cursors = [...new Set(batch.events.map((event) => event.dotRequestId))].map((id) => ({
      dotRequestId: id,
      appliedRevision: applied.get(id) ?? 0
    }))
    return { results, cursors }
  }

  return { events, post }
}
