/**
 * Claude account switching was removed (user decision 2026-10-06): a profile that still lists
 * managed Claude accounts gets one warning with the count only. Their auth folders are left
 * untouched, because they hold credentials NASH must never read, move or delete on its own.
 */
export function warnAboutRetiredClaudeAccounts(settings: unknown): void {
  if (!settings || typeof settings !== 'object' || !('claudeManagedAccounts' in settings)) {
    return
  }
  const accounts = settings.claudeManagedAccounts
  const count = Array.isArray(accounts) ? accounts.length : 0
  if (count === 0) {
    return
  }
  console.warn(
    `[settings] Claude account switching was removed; ignoring ${count} saved managed Claude account(s). No file was changed.`
  )
}
