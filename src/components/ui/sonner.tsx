'use client'

import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
} from 'lucide-react'
import { useTheme } from 'next-themes'
import { Toaster as Sonner, type ToasterProps } from 'sonner'

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = 'system' } = useTheme()

  return (
    <Sonner
      theme={theme as ToasterProps['theme']}
      // Bottom CENTRE, not sonner's bottom-right default. Every drawer in this app is a
      // right-hand `Sheet` whose footer holds the primary action, and the default stack
      // landed exactly on top of it: the read-only error raised by one save covered
      // `Create Abstract` in the Add Abstract drawer, so the toast explaining the last
      // failure blocked the button for the next attempt. Centre clears the drawer without
      // moving toasts onto the page header.
      position="bottom-center"
      // A dismiss control on every toast. Sonner pauses its auto-dismiss timer whenever
      // the document is not visible, so a toast raised just before you switch away is
      // still sitting there when you come back, and until now there was no way to clear
      // one by hand: the icon on the left is decoration, not a close button. Observed as a
      // read-only error that outlived several navigations.
      closeButton
      className="toaster group"
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      style={
        {
          '--normal-bg': 'var(--popover)',
          '--normal-text': 'var(--popover-foreground)',
          '--normal-border': 'var(--border)',
          '--border-radius': 'var(--radius)',
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: 'cn-toast',
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
