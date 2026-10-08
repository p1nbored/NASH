// The values a permission decision row holds (the store's CHECK lists) and the desktop view shows,
// defined once so the store and the wire cannot drift apart.

export const PERMISSION_DECISION_STATUSES = [
  'pending',
  'allowed',
  'denied',
  'expired',
  'answered_in_terminal'
] as const
export const PERMISSION_DECISION_DECIDERS = ['dot', 'desktop', 'terminal'] as const
export const PERMISSION_DECISION_STORED_DECIDERS = [
  ...PERMISSION_DECISION_DECIDERS,
  'primary'
] as const
