// NASH ships one icon (D-036). Saved values from Orca's former variants normalize to it.
export const APP_ICON_OPTIONS = [{ id: 'classic', label: 'NASH' }] as const

export type AppIconId = (typeof APP_ICON_OPTIONS)[number]['id']

export const DEFAULT_APP_ICON_ID: AppIconId = 'classic'

// Why: the icon picker only appears when there is more than one icon to choose from.
export const HAS_APP_ICON_CHOICE: boolean = APP_ICON_OPTIONS.length > 1

export function normalizeAppIconId(value: unknown): AppIconId {
  return APP_ICON_OPTIONS.some((option) => option.id === value)
    ? (value as AppIconId)
    : DEFAULT_APP_ICON_ID
}
