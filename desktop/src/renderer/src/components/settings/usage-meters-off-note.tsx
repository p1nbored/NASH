import { translate } from '@/i18n/i18n'

/** Stands in for the providers whose usage NASH does not read (D-023 correction, 2026-10-06). */
export function UsageMetersOffNote(): React.JSX.Element {
  return (
    <section className="space-y-1" data-testid="usage-meters-off-note">
      <h3 className="text-sm font-semibold">
        {translate('auto.components.settings.usageMetersOff.title', 'Usage is not shown in NASH')}
      </h3>
      <p className="text-xs text-muted-foreground">
        {translate(
          'auto.components.settings.usageMetersOff.body',
          'NASH does not read sign-ins or ask vendors for usage, so Gemini CLI, OpenCode Go, MiniMax, Grok, Cursor and GLM Coding Plan usage is not shown. Claude, Codex and agy report their own usage through their CLIs.'
        )}
      </p>
    </section>
  )
}
