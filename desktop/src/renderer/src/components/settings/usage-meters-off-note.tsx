import { translate } from '@/i18n/i18n'
import { SettingsSubsectionHeader } from './SettingsFormControls'

/** Stands in for the providers whose usage NASH does not read (D-023 correction, 2026-10-06). */
export function UsageMetersOffNote(): React.JSX.Element {
  return (
    <section data-testid="usage-meters-off-note">
      <SettingsSubsectionHeader
        title={translate(
          'auto.components.settings.usageMetersOff.title',
          'Usage is not shown in NASH'
        )}
        description={translate(
          'auto.components.settings.usageMetersOff.bodyPlain',
          'Only Claude Code, Codex and agy report usage, from their own CLIs. Other providers are not read.'
        )}
      />
    </section>
  )
}
