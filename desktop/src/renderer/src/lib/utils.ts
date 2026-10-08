import { clsx, type ClassValue } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

// Why: tailwind-merge only knows Tailwind's default scales; without these names it files
// `text-meta` under text colour and drops it beside `text-muted-foreground`. Keep in step with
// the `@theme static` type scale and spacing roles in assets/main.css.
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: ['caption', 'meta', 'body', 'body-lg', 'heading', 'title', 'display'],
      spacing: ['row', 'group', 'section']
    }
  }
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
