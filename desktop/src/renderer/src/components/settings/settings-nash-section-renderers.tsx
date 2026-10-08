import { DotIngressSection } from './dot-ingress-section'
import { SettingsSection } from './SettingsSection'
import { TaskRoutingPane } from './TaskRoutingPane'
import {
  getDotSettingsDescription,
  getDotSettingsTitle,
  getTaskRoutingSettingsDescription,
  getTaskRoutingSettingsTitle
} from './nash-settings-category-copy'
import type { SettingsRenderContext } from './settings-render-context'

// Why a bare body: the cards inside these categories draw their own frames.
const CARD_LIST_BODY_CLASS_NAME = 'rounded-none border-0 bg-transparent p-0 shadow-none'

export function renderTaskRoutingSettingsSection(
  context: SettingsRenderContext
): React.JSX.Element {
  const { navigation, view } = context
  return (
    <SettingsSection
      id="task-routing"
      title={getTaskRoutingSettingsTitle()}
      description={getTaskRoutingSettingsDescription()}
      searchEntries={navigation.getSectionSearchEntries('task-routing')}
      bodyClassName={CARD_LIST_BODY_CLASS_NAME}
    >
      {view.isSectionMounted('task-routing') ? <TaskRoutingPane /> : null}
    </SettingsSection>
  )
}

export function renderDotSettingsSection(context: SettingsRenderContext): React.JSX.Element {
  const { navigation, view } = context
  return (
    <SettingsSection
      id="dot"
      title={getDotSettingsTitle()}
      description={getDotSettingsDescription()}
      searchEntries={navigation.getSectionSearchEntries('dot')}
      bodyClassName={CARD_LIST_BODY_CLASS_NAME}
    >
      {view.isSectionMounted('dot') ? <DotIngressSection /> : null}
    </SettingsSection>
  )
}
