import type { Metadata } from 'next'
import { Geist, Geist_Mono, Space_Grotesk } from 'next/font/google'

import { ThemeProvider } from '@/components/shell/ThemeProvider'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'

import './globals.css'

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
})

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
})

/**
 * The display face, read only through `font-heading`. Everything else is Geist.
 * Two families is the ceiling: a third would be decoration, and the mono
 * already carries every label.
 */
const spaceGrotesk = Space_Grotesk({
  variable: '--font-display',
  subsets: ['latin'],
  weight: ['500', '600', '700'],
})

export const metadata: Metadata = {
  title: 'bodo',
  description:
    'Speaker and session operations: call for papers, speaker portal, review, and agenda building.',
}

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    // `suppressHydrationWarning` is what next-themes needs: it writes the theme
    // class onto <html> before React hydrates, so the server markup and the DOM
    // differ by that one attribute on the first pass.
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} ${spaceGrotesk.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        <ThemeProvider>
          {/* Mounted once here so no surface has an excuse to hand-roll a tooltip
              or a toast. Parity copy like "Saved successfully" goes through sonner. */}
          <TooltipProvider>{children}</TooltipProvider>
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  )
}
