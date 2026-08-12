'use client'

// Ref 33's right pane: the Preview / Get Code toggle and the browser mock.
//
// Transcribed: the tab pair with an eye icon and a code-brackets icon, the format label at top
// right, the traffic-light dots, the View dropdown, the desktop/mobile pair, "Copy code" with a
// copy icon, a refresh icon button, an open-in-new-tab icon button, and a simulated URL bar whose
// query parameter is `sb-speaker-id=abc123` followed by a "Go" button.
//
// The preview is a REAL iframe of the real public route, not a re-render of the embed inside the
// admin page. That is the only version of this control that cannot lie: the parity item is "live
// rendered embed preview", the served route is what a visitor gets, and rendering the projection
// twice through two different component trees is how a preview ends up showing something the
// embed does not. It also makes the rest of the toolbar honest rather than decorative: refresh
// remounts the frame, the device toggle changes its width, open-in-new-tab is the same URL, and Go
// puts the typed parameters on it, which is exactly what a visitor's browser would do.
//
// One thing the iframe cannot show: a DISABLED embed, whose URL answers 404 by design. So the
// frame is replaced with a notice rather than framing our own 404 page inside the editor, which
// would read as a broken preview instead of as a switched-off feed.
//
// THE VIEW DROPDOWN PREVIEWS. IT DOES NOT DEFINE. It used to write straight to the base the
// instant it changed, through its own Server Action, which was the EMB-15 defect: a brand-new
// embed had no other way to choose its view (the settings form never offered the field either),
// so this selector was carrying the entire "what does this embed serve" decision on a control the
// parity reference itself only reads as "selects which feed view to preview". The widget type now
// lives in the settings panel's Type section as an ordinary saved field (EmbedSettingsPanel.tsx);
// this selector only changes the `sb-view` deep link on the previewed URL, through
// `onViewChange`, which the caller wires to LOCAL state that never leaves the browser.

import {
  CodeXmlIcon,
  CopyIcon,
  EyeIcon,
  MonitorIcon,
  RefreshCwIcon,
  SmartphoneIcon,
  SquareArrowOutUpRightIcon,
} from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'
import { toast } from 'sonner'

import { ButtonLink } from '@/components/primitives/ButtonLink'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { parseEmbedQuery } from '@/features/cms/deep-link'
import {
  EmbedCodeTab,
  EmbedFeedNotice,
  EmbedPreviewFrame,
  EmbedTrafficLights,
} from '@/features/cms/EmbedPreviewSurfaces'
import { embedFormatUrl, embedShare } from '@/features/cms/snippet'
import { EMBED_VIEW_ITEMS, type EmbedFormat, type EmbedView, embedFormatLabel } from '@/types/cms'

/** Ref 33's parameter, value and all, so the bar demonstrates something on first sight. */
const EXAMPLE_QUERY = 'sb-speaker-id=abc123'

export type EmbedPreviewProps = {
  origin: string
  publicId: string
  name: string
  enabled: boolean
  /** What to preview: the caller's local override, or the PERSISTED view when there is none. */
  view: EmbedView
  /** The PERSISTED format. It decides the URL's extension and what Get Code hands over. */
  format: EmbedFormat
  /** Sets the caller's local override. Never persisted: see the header. */
  onViewChange: (view: EmbedView) => void
}

export function EmbedPreviewPanel(props: EmbedPreviewProps) {
  const [tab, setTab] = useState('preview')
  const [mobile, setMobile] = useState(false)
  const [query, setQuery] = useState(EXAMPLE_QUERY)
  const [applied, setApplied] = useState('')
  const [nonce, setNonce] = useState(0)

  // The view always travels on the previewed URL as the `sb-view` deep link, so switching it
  // shows immediately: there is no write to wait on any more. Anything the organizer typed is
  // validated on the way through, so a hostile value in the bar cannot reach the iframe's src.
  const link = { ...parseEmbedQuery(applied), view: props.view }
  const url = embedFormatUrl(props.origin, props.publicId, props.format, link)
  // The canonical URL, with no deep link on it: what Get Code hands over is the embed's address,
  // not whatever the organizer last typed into the demonstration bar below.
  const share = embedShare({
    origin: props.origin,
    publicId: props.publicId,
    format: props.format,
    name: props.name,
  })
  // An iframe for the two HTML formats, and the URL itself for the three feeds: there is no
  // markup to paste for a JSON, XML or calendar endpoint, and the URL is the deliverable.
  const copyable = share.snippet ?? share.url
  const copyLabel = share.snippet === undefined ? 'Copy URL' : 'Copy code'
  const formatLabel = embedFormatLabel(props.format)

  const copy = () => {
    void navigator.clipboard.writeText(copyable).then(
      () => {
        toast.success(share.snippet === undefined ? 'Embed URL copied.' : 'Embed code copied.')
      },
      () => {
        toast.error('The code could not be copied.')
      },
    )
  }

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="preview">
              <EyeIcon data-icon="inline-start" />
              Preview
            </TabsTrigger>
            <TabsTrigger value="code">
              <CodeXmlIcon data-icon="inline-start" />
              Get Code
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <span className="text-sm text-muted-foreground">{formatLabel}</span>
      </div>

      <div className="flex min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-muted/40">
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
          <EmbedTrafficLights />

          <Select
            value={props.view}
            items={EMBED_VIEW_ITEMS}
            onValueChange={(next: string | null) => {
              const match = EMBED_VIEW_ITEMS.find((item) => item.value === next)
              if (match !== undefined) props.onViewChange(match.value)
            }}
          >
            <SelectTrigger size="sm" aria-label="View">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {EMBED_VIEW_ITEMS.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <ToggleGroup
            value={[mobile ? 'mobile' : 'desktop']}
            onValueChange={(next: string[]) => {
              setMobile(next.includes('mobile'))
            }}
          >
            <ToggleGroupItem value="desktop" aria-label="Desktop preview">
              <MonitorIcon />
            </ToggleGroupItem>
            <ToggleGroupItem value="mobile" aria-label="Mobile preview">
              <SmartphoneIcon />
            </ToggleGroupItem>
          </ToggleGroup>

          {/* `gap-1` sets the pitch for this group: the two icon buttons are 32px, so 32 + 4 = 36
              is the largest centred target that lets neighbouring areas meet without crossing.
              The text button beside them is already wide enough and only wants height. */}
          <div className="ml-auto flex items-center gap-1">
            <Button variant="ghost" size="sm" className="hit-area-y" onClick={copy}>
              <CopyIcon data-icon="inline-start" />
              {copyLabel}
            </Button>
            {/* Refresh remounts the IFRAME and can do nothing else, so it is offered only
                where there is an iframe. On Get Code it was a live-looking button that did
                nothing at all when pressed. */}
            {tab === 'preview' ? (
              <Button
                variant="ghost"
                size="icon"
                className="hit-area-[36px]"
                aria-label="Refresh preview"
                onClick={() => {
                  setNonce((current) => current + 1)
                }}
              >
                <RefreshCwIcon />
              </Button>
            ) : null}
            {/* A LINK, not a Button that renders one: this navigates, so it keeps link
                semantics and gets the pending state. See ButtonLink. */}
            <ButtonLink
              href={url}
              target="_blank"
              rel="noreferrer"
              variant="ghost"
              size="icon"
              className="hit-area-[36px]"
              aria-label="Open embed in a new tab"
            >
              <SquareArrowOutUpRightIcon />
            </ButtonLink>
          </div>
        </div>

        {/* THE URL BAR BELONGS TO THE PREVIEW, and now only renders there.
            `Go` applies the typed query to `url`, and `url` reaches exactly two things: the
            iframe's src and the open-in-new-tab link. On Get Code there is no iframe, and
            the snippet is built from `share`, which carries NO deep link on purpose (an
            organizer must not paste `sb-speaker-id=abc123` into their own website by
            accident). So on that tab the bar demonstrated a parameter that could not affect
            anything below it, and pressing Go moved nothing on screen.

            Hidden rather than wired up, because the alternative contradicts a deliberate
            decision: making Go rewrite the snippet is exactly the accident the canonical
            URL exists to prevent. It also matches ref 33, which captures this bar inside
            the browser frame around the RENDERED EMBED, with Preview active, and whose own
            note reads "lets the admin test them in the preview"
            (docs/parity/cms-embeds.md). */}
        {tab === 'preview' ? (
          <div className="flex flex-wrap items-center gap-1 border-b border-border px-3 py-2 text-xs">
            <span className="truncate text-muted-foreground">{share.url}</span>
            <span className="text-muted-foreground">?</span>
            <Input
              aria-label="Query parameters"
              className="h-7 min-w-40 flex-1 font-mono text-xs"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value)
              }}
              // Enter applies, because this is shaped like an address bar and that is what
              // an address bar does. Without it the field and the button disagreed: typing
              // a parameter and pressing Enter looked like it had been ignored.
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  setApplied(query)
                }
              }}
            />
            <Button
              size="sm"
              variant="secondary"
              className="hit-area-y"
              onClick={() => {
                setApplied(query)
              }}
            >
              Go
            </Button>
          </div>
        ) : null}

        {tab === 'code' ? (
          <EmbedCodeTab snippet={copyable} hint={share.hint} copyLabel={copyLabel} onCopy={copy} />
        ) : // A disabled embed is answered first, whatever its format: its URL 404s in all five,
        // so "this embed serves JSON" would be describing a feed that is not being served.
        props.enabled && share.snippet === undefined ? (
          <EmbedFeedNotice label={formatLabel} hint={share.hint} />
        ) : (
          <EmbedPreviewFrame
            enabled={props.enabled}
            mobile={mobile}
            name={props.name}
            url={url}
            nonce={nonce}
          />
        )}
      </div>
    </div>
  )
}
