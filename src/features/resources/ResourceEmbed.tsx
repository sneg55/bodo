// The one place `Resources.embedHtml` is rendered.
//
// A sandboxed `<iframe srcdoc>`, never `dangerouslySetInnerHTML`. The reasoning, the
// guarantee, and the limits are all in ./embed.ts; the short version is that this markup
// is organizer-authored and unsanitized, so it runs in an opaque origin where it cannot
// reach the speaker's session.
//
// `title` on an iframe is a required accessible name, not a tooltip, and is exempt from
// the native-title ban in eslint.restricted-syntax.mjs.
//
// React escapes `&`, `<`, `>`, `"` and `'` when it serialises an attribute value, so a
// payload containing `"></iframe><script>` cannot close the attribute and escape into the
// parent document. That is asserted against real hostile input in
// tests/resources-embed.test.ts rather than trusted.

import {
  EMBED_HEIGHT_CLASS,
  EMBED_SANDBOX,
  embedDocument,
  embedHostLabel,
  embedSources,
  embedTitle,
} from './embed'

export type ResourceEmbedProps = {
  /** Raw, unsanitized, organizer-authored markup. */
  html: string
  /** The resource title, used to build the frame's accessible name. */
  resourceTitle: string
}

export function ResourceEmbed({ html, resourceTitle }: ResourceEmbedProps) {
  const sources = embedSources(html)

  return (
    <figure className="space-y-1.5">
      <iframe
        title={embedTitle(resourceTitle)}
        srcDoc={embedDocument(html)}
        sandbox={EMBED_SANDBOX}
        referrerPolicy="no-referrer"
        loading="lazy"
        className={`w-full rounded-md border border-border bg-background ${EMBED_HEIGHT_CLASS}`}
      />

      {/* Always rendered, never detected: `embedSources` says why a blocked embed and a
          working one cannot be told apart from this side of the frame. A blank rectangle
          with a caption is a reader who knows what is missing; a blank rectangle on its own
          is a reader who thinks the page is broken. */}
      <figcaption className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
        {sources.length === 0 ? (
          <span>
            Embedded content. If nothing appears above, your browser or network blocked it.
          </span>
        ) : (
          <>
            <span>Embedded content. If nothing appears above, open it directly:</span>
            {sources.map((source) => (
              <a
                key={source}
                href={source}
                target="_blank"
                rel="noreferrer noopener"
                className="underline underline-offset-2 hover:text-foreground"
              >
                {embedHostLabel(source)}
              </a>
            ))}
          </>
        )}
      </figcaption>
    </figure>
  )
}
