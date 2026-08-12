'use client'

// One row inside a notifications panel on step 7 (parity ref 15).
//
// Shared because the reference gives both panels the same anatomy: an icon, a name, a
// one-line description of when the email is sent, and the controls on the right. The
// screenshot only expands the "Submitter notifications" panel, so the admin rows follow the
// row it does show rather than a second layout invented for them.

import type { ReactNode } from 'react'

export type NotificationTemplateRowProps = {
  icon: ReactNode
  /** Rendered as the row's own label element by the caller, so it can own `htmlFor`. */
  title: ReactNode
  description: string
  /** The right-hand controls: a toggle, a `Customize` button, or both. */
  controls: ReactNode
}

export function NotificationTemplateRow({
  icon,
  title,
  description,
  controls,
}: NotificationTemplateRowProps) {
  return (
    <div className="flex items-start gap-3">
      {icon}
      <span className="flex min-w-0 flex-col">
        {title}
        <span className="text-xs text-muted-foreground">{description}</span>
      </span>
      <span className="ml-auto flex shrink-0 items-center gap-2">{controls}</span>
    </div>
  )
}
