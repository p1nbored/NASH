import { ClefRoutingCard } from './clef-routing-card'
import { RoutingTableCard } from './routing-table-card'
export { getTaskRoutingSearchEntries } from './task-routing-search'

/** Task routing (D-035): each kind of task with its agent and model, then the Clef classifier. */
export function TaskRoutingPane(): React.JSX.Element {
  return (
    <div className="flex flex-col gap-group">
      <RoutingTableCard />
      <ClefRoutingCard />
    </div>
  )
}
