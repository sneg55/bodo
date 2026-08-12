// Speaker-authored rich text, rendered as HTML. The sibling of `OrganizerHtml`, and separate
// from it on purpose: that component's header states as an invariant that no submitted answer
// is ever rendered through it, and that invariant is worth keeping legible rather than
// quietly widening.
//
// WHY THIS EXISTS. A session abstract is a `wysiwyg` answer, so what is stored is markup. Every
// public surface printed it as text, tags and all: the eval run of 2026-08-10 read
// `<P>NINETY MINUTES, BRING A LAPTOP.</P>` off a Session List embed, its in-builder preview,
// and the Schedule Itinerary detail modal, and the CFP wizard's own Review step showed the
// submitter `<p>Our monorepo CI took 40 minutes...</p>` as their last look before submitting.
//
// WHY IT IS SAFE NOW AND WAS NOT BEFORE. The old comments on those sinks all said the same
// thing, that this codebase has no HTML sanitizer, and they were right when they were written.
// `src/utils/safe-html.ts` is that sanitizer. The rule it comes with is the whole reason this
// component takes an already-clean string and does not clean one itself: sanitizing happens on
// the way out of the READ, never at a sink. Sinks are reached from client components, so a
// sanitize call here would ship `htmlparser2` into the embed chunks and would still leave the
// raw markup sitting in the RSC payload.
//
// So the contract is narrow and it is the caller's to keep. Pass a value that came through
// `safeRichHtml` on the server. For a session abstract that is `describeSessions` in
// @/features/agenda/public-descriptions, which is the only place a public description is
// resolved. Do NOT pass a raw answer read straight off a submission.

import { RICH_TEXT_PROSE } from '@/components/primitives/rich-text-prose'
import { cn } from '@/utils/cn'

/**
 * How stored prose breaks its lines, and the same string `OrganizerHtml` carries: inherited
 * `text-pretty` for the body so no paragraph or list item ends on an orphan, balancing for
 * the headings, which are short enough for that pass and are the case `pretty` does not
 * cover. It belongs in RICH_TEXT_PROSE with the rest of the shared rules; that file was out
 * of scope for this pass.
 */
const RICH_TEXT_WRAP = 'text-pretty [&_h1]:text-balance [&_h2]:text-balance [&_h3]:text-balance'

export function SpeakerHtml({ html, className }: { html: string; className?: string }) {
  return (
    <div
      className={cn(RICH_TEXT_PROSE, RICH_TEXT_WRAP, className)}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
