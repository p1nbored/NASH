import { Separator } from '@/components/ui/separator'
import { useWorkbenchRuns } from './use-workbench-runs'
import WorkbenchPermissionSection from './WorkbenchPermissionSection'
import WorkbenchRequestQueue from './WorkbenchRequestQueue'
import WorkbenchRunsSection from './WorkbenchRunsSection'
import WorkbenchValidationDecisionSection from './WorkbenchValidationDecisionSection'
import WorkbenchWorkspaceSection from './WorkbenchWorkspaceSection'

// Why prompts first: a waiting prompt blocks its session; undecided results, runs and requests follow.
// Why no routing section (D-016): Clef only classifies, the Routing Table lives in Settings, and each run shows its coordinator.
// Why no RSI sections (D-038): RSI is unrelated to the Workbench and lives in the left navigation.
export default function WorkbenchPanel(): React.JSX.Element {
  const runs = useWorkbenchRuns()

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-3 py-3 text-foreground scrollbar-sleek">
      <div className="space-y-3">
        <WorkbenchWorkspaceSection />
        <Separator />
        <WorkbenchPermissionSection findRun={runs.findRun} />
        <Separator />
        <WorkbenchValidationDecisionSection />
        <Separator />
        <WorkbenchRunsSection runs={runs} />
        <Separator />
        <WorkbenchRequestQueue runs={runs} />
      </div>
    </div>
  )
}
