export type WorkbenchChipTone = 'warning' | 'neutral' | 'muted'

// Why: the label carries the state; the warning tint only reinforces it, never replaces it.
export default function WorkbenchStateChip({
  status,
  label,
  tone
}: {
  status: string
  label: string
  tone: WorkbenchChipTone
}): React.JSX.Element {
  return (
    <span
      data-status={status}
      data-tone={tone}
      className="inline-flex h-5 shrink-0 items-center rounded-full border border-border px-2 text-[11px] font-medium text-foreground data-[tone=muted]:text-muted-foreground data-[tone=warning]:border-status-warning-border data-[tone=warning]:bg-status-warning-background"
    >
      {label}
    </span>
  )
}
