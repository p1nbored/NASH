// FIXTURE_ONLY: where the renderer may still say "Orca" after the NASH rename (decision D-017).
// Everything else names this app NASH. Each kept key says why "Orca" is still the true name there.

export type CatalogLocale = 'en' | 'es' | 'fr' | 'ja' | 'ko' | 'zh'

const ORCA_CLOUD =
  "Orca's cloud account service (onorca.dev), off in NASH builds (orca-cloud-services)"
const UPSTREAM = 'the open-source Orca project NASH is built on (github.com/stablyai/orca)'
const SAFETY_LIST = "Orca's plugin safety list on onorca.dev, not fetched in NASH builds"

/** Catalog keys whose text may name Orca in any locale, with the reason. */
export const KEPT_ORCA_CATALOG_KEYS: Readonly<Record<string, string>> = {
  'auto.components.skills.SkillShareDialog.reconnect': ORCA_CLOUD,
  'auto.components.skills.SkillShareDialog.readyDescription': ORCA_CLOUD,
  'auto.components.skills.install.reconnectBeforeInstalling': ORCA_CLOUD,
  'auto.components.skills.install.reconnectForVersionHistory': ORCA_CLOUD,
  'auto.components.skills.install.reconnectBeforeVersionChange': ORCA_CLOUD,
  'auto.components.skills.install.enterShareLink': `${ORCA_CLOUD}: skill share links`,
  'auto.components.skills.SkillInstallReviewContent.93eb0fe8c7': `${ORCA_CLOUD}: skill share links`,
  'auto.components.settings.artifacts.account': ORCA_CLOUD,
  'auto.components.settings.artifacts.signIn': ORCA_CLOUD,
  'auto.components.settings.artifacts.signInDescription': ORCA_CLOUD,
  'auto.components.settings.orcaAccount.account': ORCA_CLOUD,
  'auto.components.settings.orcaAccount.signIn': ORCA_CLOUD,
  'auto.components.settings.orcaAccount.title': ORCA_CLOUD,
  'auto.components.settings.orcaAccount.unavailable': ORCA_CLOUD,
  'auto.components.settings.shareSkills.signInDescription': ORCA_CLOUD,
  'auto.components.settings.shareSkills.signIn': ORCA_CLOUD,
  'auto.components.orca.profiles.signout.confirm.title': ORCA_CLOUD,
  'auto.components.orca.profiles.signout.confirm.description': ORCA_CLOUD,
  'auto.components.mobile.MobileRelayMintFailureNotice.reconnectTitle': ORCA_CLOUD,
  'auto.components.artifacts.ArtifactsPage.signInAgain': ORCA_CLOUD,
  'auto.components.artifacts.ArtifactsPage.signInHeading': ORCA_CLOUD,
  'auto.components.artifacts.ArtifactsPage.signInCopy': ORCA_CLOUD,
  'auto.components.artifacts.ArtifactsPage.signIn': ORCA_CLOUD,
  'auto.components.artifacts.ArtifactsPage.reconnectHeading': ORCA_CLOUD,
  'auto.components.artifacts.ArtifactsPage.unconfiguredCopy': ORCA_CLOUD,
  'auto.components.artifacts.ArtifactPublishButton.accountTitle': ORCA_CLOUD,
  'auto.components.artifacts.artifact-publish-flow.bba20daa6d': ORCA_CLOUD,
  'auto.components.UnexpectedSignoutCard.c5b3e8a17d': ORCA_CLOUD,
  'auto.components.settings.GeneralSupportSection.55a87e5fd1': UPSTREAM,
  'auto.components.settings.GeneralSupportSection.6922c1fa2b': UPSTREAM,
  'auto.components.settings.general.search.36a72f0d9e': UPSTREAM,
  'auto.components.StarNagCard.30c36231c1': UPSTREAM,
  'auto.components.star.nag.StarNagToastHost.body': UPSTREAM,
  'auto.components.sidebar.SidebarFeedbackDialog.a828fa4aee':
    'upstream feedback goes to the Orca team (onorca.dev/v1/feedback); NASH sends none',
  'auto.components.settings.PluginMarketplaceListingRow.blocked': SAFETY_LIST,
  'auto.components.settings.PluginMarketplacePreviewDialog.blocked': SAFETY_LIST,
  'auto.components.settings.PluginSettingsRow.killListMessage': SAFETY_LIST
}

// Why per locale: translators render the service names differently; each pattern names an Orca service or file.
const SHARED_SERVICES = String.raw`Orca (?:Relay|Mobile|Cloud)\b`

/** Phrases that may name Orca in any key: Orca Relay, Orca Mobile (the phone app) and Orca Cloud. */
export const ORCA_SERVICE_PHRASES: Readonly<Record<CatalogLocale, readonly RegExp[]>> = {
  en: [new RegExp(SHARED_SERVICES, 'g'), /Orca mobile app/g],
  es: [new RegExp(SHARED_SERVICES, 'g'), /Orca Móvil/g, /móvil de Orca/g],
  fr: [new RegExp(SHARED_SERVICES, 'g'), /mobile Orca/g, /Relais Orque/g],
  ja: [new RegExp(SHARED_SERVICES, 'g'), /Orca ?(?:モバイル|リレー)/g],
  ko: [new RegExp(SHARED_SERVICES, 'g'), /Orca ?(?:모바일|릴레이)/g],
  zh: [new RegExp(SHARED_SERVICES, 'g'), /Orca ?(?:手机|云|接力赛|中继)/g, /Orca\.yaml/g]
}

/** The product token per locale; the French catalog sometimes translated the name as "Orque". */
export const PRODUCT_TOKEN: Readonly<Record<CatalogLocale, RegExp>> = {
  en: /(?<![A-Za-z])Orca(?![A-Za-z])/,
  es: /(?<![A-Za-z])Orca(?![A-Za-z])/,
  fr: /(?<![A-Za-z])(?:Orca|Orque)(?![A-Za-z])/,
  ja: /(?<![A-Za-z])Orca(?![A-Za-z])/,
  ko: /(?<![A-Za-z])Orca(?![A-Za-z])/,
  zh: /(?<![A-Za-z])Orca(?![A-Za-z])/
}

/** Old identity values (lowercase; matched case-insensitively) that must never appear in visible text. */
export const RETIRED_IDENTITY_VALUES: readonly string[] = ['orca://', '~/.orca']

export type InlineOrcaAllowance = { file: string; text: string; reason: string }

const SKILL_PROMPT =
  'agent prompt naming the in-session `orca` alias, which still works; the bundled skills now teach `nash`, so rename it with its six catalog values'

/** Inline (non-catalog) renderer strings that may still name Orca. */
export const INLINE_ORCA_ALLOWED: readonly InlineOrcaAllowance[] = [
  {
    file: 'lib/monospace-font-family.ts',
    text: 'Orca Nerd Font Symbols',
    reason: 'font-family name of a bundled font face, not visible copy'
  },
  {
    file: 'components/plugin-catalog/plugin-display-name.ts',
    text: 'Orca',
    reason: 'capitalizes the word "orca" inside third-party plugin keys'
  },
  {
    file: 'components/activity/dev-activity-fixture.ts',
    text: 'Orca Sample App',
    reason: 'dev-only sample data'
  },
  { file: 'components/settings/BrowserUseExamples.tsx', text: 'Orca CLI', reason: SKILL_PROMPT },
  {
    file: 'components/settings/MobileEmulatorExamples.tsx',
    text: 'Orca CLI',
    reason: SKILL_PROMPT
  },
  {
    file: 'components/settings/MobileEmulatorAgentControlRow.tsx',
    text: 'orca emulator',
    reason: SKILL_PROMPT
  },
  {
    file: 'components/emulator-pane/MobileEmulatorAgentSetupGuideSteps.tsx',
    text: 'orca emulator',
    reason: 'names the commands the bundled orca-emulator skill teaches agents'
  },
  {
    file: 'components/sidebar/WorktreeCardCliDetailSection.tsx',
    text: '`orca worktree create`',
    reason: 'agents create worktrees through the in-session `orca` alias the bundled skill teaches'
  },
  {
    file: 'components/crash-report/CrashReportDialogSurface.tsx',
    text: 'the Orca team',
    reason: 'upstream crash reports go to the Orca team (onorca.dev/v1/feedback); NASH sends none'
  },
  {
    file: 'store/slices/orca-profiles.ts',
    text: 'Orca profile',
    reason: `console diagnostics about ${ORCA_CLOUD}`
  },
  {
    file: 'store/slices/orca-profiles-auth-actions.ts',
    text: 'Orca profile',
    reason: `console diagnostics about ${ORCA_CLOUD}`
  },
  {
    file: 'store/slices/orca-profiles-auth-actions.ts',
    text: 'Orca cloud profile',
    reason: `console diagnostics about ${ORCA_CLOUD}`
  }
]
