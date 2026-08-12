'use client'

// The two things ref 33's browser mock can show, plus its window dots. Split out of
// EmbedPreviewPanel.tsx to keep both files inside the file-size budget; the toolbar and its state
// live there, and these three take only what they render.

import { CopyIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/utils/cn'

/**
 * The Preview tab: the real public route in an iframe, or a notice when it is switched off.
 *
 * A disabled embed's URL answers a genuine 404 (that is the point of the toggle), so framing it
 * would put our not-found page inside the editor and read as a broken preview. The notice says
 * which of the two it is and what to do about it.
 */
export function EmbedPreviewFrame({
  enabled,
  mobile,
  name,
  url,
  nonce,
}: {
  enabled: boolean
  mobile: boolean
  name: string
  url: string
  /** Bumped by the refresh button. See the `key` below. */
  nonce: number
}) {
  if (!enabled) {
    return (
      <p className="text-pretty p-8 text-center text-sm text-muted-foreground">
        This embed is disabled, so its URL is not served. Turn Enabled on to preview it.
      </p>
    )
  }

  return (
    <div className="flex justify-center bg-background p-3">
      {/* `key` on the nonce IS the refresh button: remounting is the only way to make an iframe
          reload a URL it is already showing, since assigning the same src is a no-op. */}
      <iframe
        key={nonce}
        title={`${name} preview`}
        src={url}
        className={cn(
          'h-[28rem] w-full rounded-lg border border-border bg-background',
          mobile && 'max-w-[390px]',
        )}
      />
    </div>
  )
}

/**
 * The Get Code tab.
 *
 * Its contents are AUTHORED: both screenshots have Preview selected, so
 * docs/parity/cms-embeds.md records what this tab outputs as an ambiguity. It shows whatever the
 * embed's Format makes copyable (`embedShare`), and the copy button is the same handler as the
 * toolbar's so the two cannot hand over different text.
 *
 * `copyLabel` varies because the copied thing does: an iframe for the two HTML formats, and the
 * feed's own URL for JSON, XML and iCal, where there is no markup to paste.
 */
export function EmbedCodeTab({
  snippet,
  hint,
  copyLabel,
  onCopy,
}: {
  snippet: string
  hint: string
  copyLabel: string
  onCopy: () => void
}) {
  return (
    <div className="flex flex-col gap-2 bg-background p-3">
      <pre className="overflow-x-auto rounded-lg border border-border bg-muted/50 p-3 text-xs">
        <code>{snippet}</code>
      </pre>
      <p className="text-pretty text-xs text-muted-foreground">{hint}</p>
      <Button variant="secondary" size="sm" className="hit-area-y self-start" onClick={onCopy}>
        <CopyIcon data-icon="inline-start" />
        {copyLabel}
      </Button>
    </div>
  )
}

/**
 * The Preview tab for a format an `<iframe>` cannot present.
 *
 * A JSON or XML document framed inside the editor is a wall of raw text, and a `text/calendar`
 * response is served as an attachment, so framing one starts a DOWNLOAD in the organizer's
 * browser every time the editor renders. Neither is a preview, so neither is shown: the tab says
 * what the URL answers with and offers to open it, which is the honest version of both.
 */
export function EmbedFeedNotice({ label, hint }: { label: string; hint: string }) {
  return (
    <div className="flex flex-col items-center gap-1 p-8 text-center">
      <p className="text-sm font-medium">This embed serves {label}.</p>
      <p className="text-pretty text-sm text-muted-foreground">{hint}</p>
    </div>
  )
}

/** The macOS window dots ref 33 shows. Decoration, and hidden from a screen reader as such. */
export function EmbedTrafficLights() {
  return (
    <div aria-hidden className="flex items-center gap-1.5 pr-1">
      <span className="size-2.5 rounded-full bg-destructive/60" />
      <span className="size-2.5 rounded-full bg-muted-foreground/40" />
      <span className="size-2.5 rounded-full bg-primary/50" />
    </div>
  )
}
