import { createLocalizedCatalog } from '@/i18n/localized-catalog'
import { translate } from '@/i18n/i18n'
import type { SettingsSearchEntry } from './settings-search'
import { translateSearchKeyword } from './settings-search-keywords'

/** Settings search for the Task routing category: the Clef classifier and the Routing Table. */
export const getTaskRoutingSearchEntries = createLocalizedCatalog((): SettingsSearchEntry[] => [
  {
    title: translate('auto.components.settings.clef.card.title', 'Clef'),
    description: translate(
      'auto.components.settings.integrations.search.clefRoutingDescription',
      'Save the Clef API token and account ID used to route Workbench requests.'
    ),
    keywords: [
      ...translateSearchKeyword('auto.components.settings.integrations.search.clef', 'clef', {
        englishOnly: true
      }),
      ...translateSearchKeyword('auto.components.settings.integrations.search.routing', 'routing'),
      ...translateSearchKeyword(
        'auto.components.settings.integrations.search.cloudflare',
        'cloudflare',
        { englishOnly: true }
      ),
      ...translateSearchKeyword(
        'auto.components.settings.integrations.search.workbench',
        'workbench'
      ),
      ...translateSearchKeyword(
        'auto.components.settings.integrations.search.2ec2bd328c',
        'api token'
      ),
      ...translateSearchKeyword(
        'auto.components.settings.integrations.search.accountId',
        'account id'
      ),
      ...translateSearchKeyword(
        'auto.components.settings.integrations.search.20540996ef',
        'credentials'
      )
    ]
  },
  {
    title: translate('auto.components.settings.routingTable.card.title', 'Agents for each task'),
    description: translate(
      'auto.components.settings.taskRouting.search.agentsDescription',
      'Choose the agent, model and effort for each kind of task, and accept or reject suggested changes.'
    ),
    keywords: [
      ...translateSearchKeyword(
        'auto.components.settings.integrations.search.routingTableKeyword',
        'routing table'
      ),
      ...translateSearchKeyword('auto.components.settings.integrations.search.model', 'model'),
      ...translateSearchKeyword(
        'auto.components.settings.integrations.search.reasoning',
        'reasoning'
      ),
      ...translateSearchKeyword(
        'auto.components.settings.integrations.search.proposal',
        'proposal'
      ),
      ...translateSearchKeyword(
        'auto.components.settings.integrations.search.executor',
        'executor'
      ),
      ...translateSearchKeyword('auto.components.settings.taskRouting.search.effort', 'effort'),
      ...translateSearchKeyword('auto.components.settings.taskRouting.search.agent', 'agent')
    ]
  }
])
