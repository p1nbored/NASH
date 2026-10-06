import { Separator } from '@/components/ui/separator'
import { translate } from '@/i18n/i18n'
import { useWorkbenchRuns } from './use-workbench-runs'
import WorkbenchPermissionSection from './WorkbenchPermissionSection'
import WorkbenchRequestQueue from './WorkbenchRequestQueue'
import WorkbenchRunsSection from './WorkbenchRunsSection'
import WorkbenchUnconnectedSection from './WorkbenchUnconnectedSection'
import WorkbenchValidationDecisionSection from './WorkbenchValidationDecisionSection'
import WorkbenchWorkspaceSection from './WorkbenchWorkspaceSection'

// Why prompts first: a waiting prompt blocks its session; undecided results, runs and requests follow.
// Why no routing section (D-016): Clef only classifies, the Routing Table lives in Settings, and each run shows its coordinator.
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
        <Separator />
        <WorkbenchUnconnectedSection
          id="workbench-rsi"
          title={translate('workbench.rsi.title', 'RSI Lab')}
        >
          <p>
            {translate(
              'workbench.rsi.blocker',
              'Baseline, candidate, sandbox evaluation and promotion evidence are not connected.'
            )}
          </p>
        </WorkbenchUnconnectedSection>
        <Separator />
        <WorkbenchUnconnectedSection
          id="workbench-improvements"
          title={translate('workbench.improvements.title', 'Improvements')}
        >
          <p>
            {translate(
              'workbench.improvements.blocker',
              'The improvement inbox and proposal review are not connected.'
            )}
          </p>
        </WorkbenchUnconnectedSection>
      </div>
    </div>
  )
}
