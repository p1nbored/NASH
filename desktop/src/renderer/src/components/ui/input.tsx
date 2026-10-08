import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'

const inputVariants = cva(
  [
    // Why: the field edge is a control border (3:1 or more), not the decorative hairline.
    'w-full min-w-0 appearance-none rounded-md border border-control bg-transparent transition-[color,box-shadow] outline-none selection:bg-primary selection:text-primary-foreground file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground/60 dark:bg-input/30',
    'focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring',
    'disabled:pointer-events-none disabled:cursor-not-allowed disabled:border-border disabled:bg-muted disabled:text-disabled-foreground dark:disabled:bg-muted',
    'aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40'
  ],
  {
    variants: {
      // Matches Button heights: default 36px, sm 32px, xs 28px.
      size: {
        default: 'h-9 px-3 py-1 text-base md:text-sm',
        sm: 'h-8 px-2.5 py-1 text-xs',
        xs: 'h-7 px-2 py-0.5 text-xs'
      }
    },
    defaultVariants: {
      size: 'default'
    }
  }
)

type InputProps = Omit<React.ComponentProps<'input'>, 'size'> & VariantProps<typeof inputVariants>

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, size = 'default', ...props }, ref) => {
    return (
      <input
        ref={ref}
        type={type}
        data-slot="input"
        data-size={size}
        className={cn(inputVariants({ size }), className)}
        {...props}
      />
    )
  }
)

Input.displayName = 'Input'

export { Input, inputVariants }
