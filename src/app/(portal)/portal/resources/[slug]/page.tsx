// /portal/resources/[slug]: the reader. This is where R8's acceptance criterion lands.
//
// The page body does the read and calls `notFound()` itself, rather than streaming the
// resolution inside `<Suspense>`. Two reasons, and the first is not negotiable: a
// `notFound()` from inside a boundary resolves after the shell has flushed and never
// produces a response, which on Workers is a hung request the runtime cancels
// (.claude/rules/bodo-conventions.md). The second is that the page TITLE is the resource's
// own title, so there is nothing to paint before the record is known anyway.
//
// `readPortalResource` resolves the slug out of the visible list, so a draft page cannot be
// reached by guessing its URL, and it calls `requireSpeaker()` itself rather than trusting
// the layout above it. Both matter here more than anywhere else in the app, because this is
// the page that renders unsanitized organizer HTML.

import { notFound } from 'next/navigation'

import { PortalFrame } from '@/features/portal/PortalFrame'
import { hasEmbed } from '@/features/resources/embed'
import { MarkdownBody } from '@/features/resources/MarkdownBody'
import { markdownBlocks } from '@/features/resources/markdown'
import { ResourceEmbed } from '@/features/resources/ResourceEmbed'
import { readPortalResource } from '@/features/resources/reads'

export default async function PortalResourcePage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const resource = await readPortalResource(slug)
  if (resource === undefined) notFound()

  const blocks = markdownBlocks(resource.bodyMarkdown ?? '')

  return (
    <PortalFrame pageTitle={resource.title} activeNav="resources">
      <article className="mx-auto flex w-full max-w-3xl flex-col gap-6">
        {blocks.length > 0 ? <MarkdownBody blocks={blocks} /> : null}

        {hasEmbed(resource.embedHtml) ? (
          // The one place organizer markup is rendered, and it is rendered inside a
          // sandboxed frame with no `allow-same-origin`. See @/features/resources/embed.
          <ResourceEmbed html={resource.embedHtml ?? ''} resourceTitle={resource.title} />
        ) : null}

        {blocks.length === 0 && !hasEmbed(resource.embedHtml) ? (
          <p className="text-sm text-muted-foreground">This page has no content yet.</p>
        ) : null}
      </article>
    </PortalFrame>
  )
}
