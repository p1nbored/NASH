import { createLocalizedCatalog } from '@/i18n/localized-catalog'
import { translate } from '@/i18n/i18n'
import type { SettingsSearchEntry } from './settings-search'
import { translateSearchKeyword } from './settings-search-keywords'

/** Settings search for the dot section of the Integrations pane. */
export const getDotIngressSearchEntries = createLocalizedCatalog((): SettingsSearchEntry[] => [
  {
    title: translate('auto.components.settings.integrations.search.dotIngress', 'Tasks from dot'),
    description: translate(
      'auto.components.settings.integrations.search.dotIngressDescription',
      'Turn the local dot interface on or off, choose the workspaces dot can use and their maximum access, and set submission limits.'
    ),
    keywords: [
      ...translateSearchKeyword('auto.components.settings.integrations.search.dot', 'dot', {
        englishOnly: true
      }),
      ...translateSearchKeyword(
        'auto.components.settings.integrations.search.workspaceWrite',
        'workspace write'
      ),
      ...translateSearchKeyword(
        'auto.components.settings.integrations.search.readOnly',
        'read only'
      ),
      ...translateSearchKeyword(
        'auto.components.settings.integrations.search.rateLimit',
        'rate limit'
      ),
      ...translateSearchKeyword(
        'auto.components.settings.integrations.search.submissionLimit',
        'submission limit'
      )
    ]
  },
  {
    title: translate('auto.components.settings.dotRemote.name', 'Remote access (GPT Sites)'),
    description: translate(
      'auto.components.settings.integrations.search.dotRemoteDescription',
      'Let dot reach this app through a mailbox on your GPT Site: the switch, the Site origin and access token, pairing and revocation.'
    ),
    keywords: [
      ...translateSearchKeyword(
        'auto.components.settings.integrations.search.remoteAccess',
        'remote access'
      ),
      ...translateSearchKeyword(
        'auto.components.settings.integrations.search.gptSites',
        'GPT Sites',
        {
          englishOnly: true
        }
      ),
      ...translateSearchKeyword('auto.components.settings.integrations.search.pairing', 'pairing'),
      ...translateSearchKeyword(
        'auto.components.settings.integrations.search.accessToken',
        'access token'
      )
    ]
  }
])
