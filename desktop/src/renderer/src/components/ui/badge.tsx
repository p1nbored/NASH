import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { Slot } from 'radix-ui'

import { cn } from '@/lib/utils'

const badgeVariants = cva(
  // Why (D12): badges are 4px chips; only `counter` is a pill. Status chips pair colour with a label.
  'inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-sm border border-transparent px-1.5 py-0.5 text-xs font-medium whitespace-nowrap transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring aria-invalid:border-destructive [&>svg]:pointer-events-none [&>svg]:size-3',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground [a&]:hover:bg-primary/90',
        secondary: 'bg-secondary text-secondary-foreground [a&]:hover:bg-secondary/90',
        dot: 'border-border bg-background text-foreground dark:border-input dark:bg-secondary',
        destructive: 'bg-destructive text-destructive-foreground [a&]:hover:bg-destructive/90',
        outline: 'border-border text-foreground [a&]:hover:bg-hover',
        ghost: '[a&]:hover:bg-hover',
        link: 'text-primary underline-offset-4 [a&]:hover:underline',
        success: 'border-status-success-border bg-status-success-background text-status-success',
        warning: 'border-status-warning-border bg-status-warning-background text-status-warning',
        error: 'border-status-error-border bg-status-error-background text-status-error',
        /** Counts only (unread, queued). */
        counter: 'min-w-5 rounded-full border-border bg-muted text-muted-foreground tabular-nums',
        /** The chip naming the machine a workspace runs on — quieter and squarer than `secondary`,
         *  so it reads as context beside a workspace name rather than as a status of its own. */
        hostContext:
          'h-4 border-border bg-accent px-1.5 text-[10px] leading-none text-muted-foreground dark:border-border/50 dark:bg-accent/80'
      }
    },
    defaultVariants: {
      variant: 'default'
    }
  }
)

function Badge({
  className,
  variant = 'default',
  asChild = false,
  ...props
}: React.ComponentProps<'span'> & VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : 'span'

  return (
    <Comp
      data-slot="badge"
      data-variant={variant}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  )
}

export { Badge, badgeVariants }
