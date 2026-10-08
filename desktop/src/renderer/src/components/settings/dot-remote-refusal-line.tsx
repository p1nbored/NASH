import type { DotRemoteModel, DotRemoteScope } from './use-dot-remote-access'

/** A refused change stays visible next to the control it came from until the next change. */
export function DotRemoteRefusalLine({
  model,
  scope
}: {
  model: DotRemoteModel
  scope: DotRemoteScope
}): React.JSX.Element | null {
  if (model.refusal?.scope !== scope) {
    return null
  }
  return (
    <p role="alert" className="text-meta text-destructive">
      {model.refusal.message}
    </p>
  )
}
