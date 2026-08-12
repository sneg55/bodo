'use client'

import { ThemeProvider as NextThemeProvider } from 'next-themes'
import type { ReactNode } from 'react'

/**
 * Three choices, and the default is the visitor's OS: `system` resolves through
 * `prefers-color-scheme` and keeps tracking it, so an organizer who flips their
 * machine to night mode at 6pm gets the dark palette without touching this app.
 * Picking Day or Night explicitly pins it and stops the tracking, which is what
 * `enableSystem` buys over a two-state toggle.
 *
 * The token blocks in globals.css are shaped the standard way (`:root` light,
 * `.dark` dark) because every `dark:` variant in the app keys on `.dark` being
 * present: inverting the blocks would flip all of them silently. next-themes
 * adds and removes that one class, so the resolved theme drives everything.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  return (
    <NextThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      {children}
    </NextThemeProvider>
  )
}
