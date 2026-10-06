// Constant English text per request state; dot gets coarse state and these sentences, nothing else.

/**
 * `received`: recorded, the intake call has not finished (a crash or a refusing door leaves it here
 * briefly). `submitted`: the Workbench request exists and the app starts work without any further step.
 */
export const DOT_REQUEST_STATES = ['received', 'submitted', 'canceled', 'failed'] as const
export type DotRequestState = (typeof DOT_REQUEST_STATES)[number]

export const DOT_REQUEST_STATUS_TEXT = {
  received: 'The request was recorded and is being handed to the workbench.',
  submitted: 'The request was handed to the workbench and starts without further confirmation.',
  canceled: 'This request was canceled.',
  failed: 'The request could not be handed to the workbench.'
} as const satisfies Record<DotRequestState, string>
