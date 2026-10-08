import {
  Ban,
  CircleCheck,
  CircleDashed,
  CircleDot,
  CircleMinus,
  CircleQuestionMark,
  CircleX,
  Hourglass,
  ShieldAlert,
  Unplug,
  type LucideIcon
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'

/** What a state means to the user; each kind has its own icon, so colour never carries it alone. */
export type WorkbenchChipKind =
  | 'progress'
  | 'running'
  | 'waiting'
  | 'permission'
  | 'blocked'
  | 'failed'
  | 'disconnected'
  | 'unknown'
  | 'done'
  | 'ended'

export type WorkbenchChipCopy = { readonly kind: WorkbenchChipKind; readonly label: string }

type ChipTone = 'warning' | 'error' | 'success' | 'plain' | 'quiet'

const ICONS: Readonly<Record<WorkbenchChipKind, LucideIcon>> = {
  progress: CircleDashed,
  running: CircleDot,
  waiting: Hourglass,
  permission: ShieldAlert,
  blocked: Ban,
  failed: CircleX,
  disconnected: Unplug,
  unknown: CircleQuestionMark,
  done: CircleCheck,
  ended: CircleMinus
}

// Why: states that need the user (waiting, blocked, lost contact) take the warning chip and
// failures the error chip; only a settled success gets a green icon, and unknown never does.
const TONES: Readonly<Record<WorkbenchChipKind, ChipTone>> = {
  progress: 'quiet',
  running: 'plain',
  waiting: 'warning',
  permission: 'warning',
  blocked: 'warning',
  failed: 'error',
  disconnected: 'warning',
  unknown: 'quiet',
  done: 'success',
  ended: 'quiet'
}

const BADGE_VARIANTS = {
  warning: 'warning',
  error: 'error',
  success: 'ghost',
  plain: 'ghost',
  quiet: 'ghost'
} as const

/** The Badge status chip with an icon; states that need no attention stay untinted. */
export default function WorkbenchStateChip({ kind, label }: WorkbenchChipCopy): React.JSX.Element {
  const Icon = ICONS[kind]
  const tone = TONES[kind]
  return (
    <Badge variant={BADGE_VARIANTS[tone]} data-kind={kind} data-tone={tone}>
      <Icon
        aria-hidden="true"
        data-tone={tone}
        className="data-[tone=quiet]:text-muted-foreground data-[tone=success]:text-status-success"
      />
      <span data-tone={tone} className="data-[tone=quiet]:text-muted-foreground">
        {label}
      </span>
    </Badge>
  )
}
