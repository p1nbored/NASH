'use client'

import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { Minus, XIcon } from 'lucide-react'
import * as DialogPrimitive from 'radix-ui/dialog'

import { cn } from '@/lib/utils'
import { handleImeOverlayEscape } from '@/lib/ime-overlay-escape'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { translate } from '@/i18n/i18n'

function Dialog({ ...props }: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />
}

function DialogTrigger({ ...props }: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogPortal({ ...props }: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogClose({ ...props }: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

function DialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      // Why: the scrim token plus a 2px blur lifts the dialog off the canvas in both themes.
      className={cn(
        'fixed inset-0 z-50 bg-scrim backdrop-blur-[2px] data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0',
        className
      )}
      {...props}
    />
  )
}

const dialogContentSurfaceVariants = cva('', {
  variants: {
    surface: {
      default: '',
      /** The tinted, edge-to-edge panel of the two-column feature tip dialogs. */
      'feature-tip': 'gap-0 bg-muted p-0'
    }
  },
  defaultVariants: { surface: 'default' }
})

function DialogContentCloseButton({ variant }: { variant: 'close' | 'minimize' }) {
  const label =
    variant === 'minimize'
      ? translate('auto.components.ui.dialog.minimize', 'Minimize')
      : translate('auto.components.ui.dialog.f26c4baeda', 'Close')
  const button = (
    <DialogPrimitive.Close
      data-slot="dialog-close"
      className="absolute top-4 right-4 rounded-xs opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:outline-hidden disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"
    >
      {variant === 'minimize' ? <Minus className="size-3.5" /> : <XIcon />}
      <span className="sr-only">{label}</span>
    </DialogPrimitive.Close>
  )
  return variant === 'minimize' ? (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent side="top" sideOffset={4}>
        {label}
      </TooltipContent>
    </Tooltip>
  ) : (
    button
  )
}

function DialogContent({
  className,
  children,
  overlayClassName,
  showCloseButton = true,
  closeButtonVariant = 'close',
  surface,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> &
  VariantProps<typeof dialogContentSurfaceVariants> & {
    overlayClassName?: string
    showCloseButton?: boolean
    closeButtonVariant?: 'close' | 'minimize'
  }) {
  return (
    <DialogPortal data-slot="dialog-portal">
      <DialogOverlay className={overlayClassName} />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        // Why: one opaque paper recipe for every floating layer (floating-border edge, popover
        // fill, themed floating shadow) keeps menus, popovers and dialogs a family in both themes.
        // grid-cols-[minmax(0,1fr)]: default grid column sizes to min-content, so an
        // unbreakable token (long filename in the title) widens the column past the
        // panel and pushes justify-end footers outside the visible surface.
        className={cn(
          'fixed top-[50%] left-[50%] z-50 grid w-full max-w-[calc(100%-2rem)] grid-cols-[minmax(0,1fr)] translate-x-[-50%] translate-y-[-50%] gap-4 rounded-xl border border-floating-border bg-popover p-6 text-popover-foreground shadow-floating duration-200 outline-none data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 sm:max-w-lg',
          dialogContentSurfaceVariants({ surface }),
          className
        )}
        {...props}
        onEscapeKeyDown={(event) => handleImeOverlayEscape(event, props.onEscapeKeyDown)}
      >
        {children}
        {showCloseButton && <DialogContentCloseButton variant={closeButtonVariant} />}
      </DialogPrimitive.Content>
    </DialogPortal>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="dialog-header"
      className={cn('flex flex-col gap-2 text-center sm:text-left', className)}
      {...props}
    />
  )
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<'div'> & {
  showCloseButton?: boolean
}) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn('flex flex-col-reverse gap-2 sm:flex-row sm:justify-end', className)}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close asChild>
          <Button variant="outline">
            {translate('auto.components.ui.dialog.f26c4baeda', 'Close')}
          </Button>
        </DialogPrimitive.Close>
      )}
    </div>
  )
}

function DialogTitle({
  className,
  size = 'default',
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title> & {
  /** `display` is the large headline of the two-column feature tip dialogs. */
  size?: 'default' | 'display'
}) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      data-size={size}
      className={cn(
        'font-display text-xl font-normal data-[size=display]:text-display break-words',
        className
      )}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn('text-sm text-muted-foreground', className)}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger
}
