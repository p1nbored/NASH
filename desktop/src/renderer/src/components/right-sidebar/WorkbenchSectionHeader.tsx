import type { ReactNode } from 'react'

// Why: section heads sit one step above 14px field labels, like the settings subsection heading.
export default function WorkbenchSectionHeader({
  id,
  title,
  children
}: {
  id: string
  title: string
  children?: ReactNode
}): React.JSX.Element {
  return (
    <div className="flex min-h-6 items-center justify-between gap-2">
      <h2 id={id} className="font-sans text-heading font-semibold">
        {title}
      </h2>
      {children}
    </div>
  )
}
