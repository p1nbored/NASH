import type { DotIngressModel, DotIngressScope } from './use-dot-ingress-settings'

/** A refused change stays visible in the card it came from until the next change. */
export function DotIngressRefusalLine({
  model,
  scope
}: {
  model: DotIngressModel
  scope: DotIngressScope
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
