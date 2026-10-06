/**
 * Focus is unclaimed when it fell to the page body (its control was removed or disabled) or is
 * still inside one of `scopes`. Anywhere else, the user moved on and keeps that focus.
 */
export function isFocusUnclaimed(scopes: readonly (Element | null)[]): boolean {
  const active = document.activeElement
  if (active === null || active === document.body || active === document.documentElement) {
    return true
  }
  return scopes.some((scope) => scope !== null && scope.contains(active))
}

function canTakeFocus(target: HTMLElement | null): target is HTMLElement {
  return target !== null && target.isConnected && !target.hasAttribute('disabled')
}

/** Focuses the first usable target, but never pulls focus away from where the user went. */
export function moveFocusIfUnclaimed(
  targets: readonly (HTMLElement | null)[],
  scopes: readonly (Element | null)[]
): boolean {
  if (!isFocusUnclaimed(scopes)) {
    return false
  }
  const target = targets.find(canTakeFocus)
  if (target === undefined) {
    return false
  }
  target.focus()
  return document.activeElement === target
}
