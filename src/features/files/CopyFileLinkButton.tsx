'use client'

// Copy a link to one stored file, so a row can be handed to a colleague.
//
// The gap it closes: every file row offered Open or Download and nothing that produced a
// shareable address, so passing a speaker's deck to a track chair meant downloading it and
// re-sending the bytes. An eval agent searched this surface for a share action and reported it
// absent.
//
// WHAT IT COPIES IS NOT A CAPABILITY, and the copy says so rather than implying a public link.
// The private href is `/api/files/<id>?event=<id>`, a route that calls `requireEventRole` on
// the caller's own session and answers 401 to somebody with no membership (see that route's
// own note). So this is a pointer for a teammate, not a way to publish a file, and describing
// it as "anyone with the link" would be false. A public object's href is a bucket URL and is
// genuinely public, which is why the confirmation differs between the two.

import { LinkIcon } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

export function CopyFileLinkButton({
  href,
  filename,
  isPrivate,
}: {
  /** The row's own href, relative for a private object and absolute for a public one. */
  href: string
  filename: string
  isPrivate: boolean
}) {
  const copy = () => {
    void (async () => {
      // Absolute, because a relative path pasted into a chat window is not a link.
      const url = href.startsWith('http') ? href : `${globalThis.location.origin}${href}`
      try {
        await globalThis.navigator.clipboard.writeText(url)
        toast.success('Link copied', {
          description: isPrivate
            ? `${filename} opens for anybody with a role on this event.`
            : `${filename} is a public file and the link opens for anybody.`,
        })
      } catch {
        // Clipboard access is refused outside a secure context, and a button that silently
        // does nothing is the failure this whole surface is being fixed for.
        toast.error('Could not copy the link', { description: url })
      }
    })()
  }

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            className="hit-area"
            aria-label={`Copy link to ${filename}`}
            onClick={copy}
          >
            <LinkIcon />
          </Button>
        }
      />
      <TooltipContent>
        {isPrivate
          ? 'Copy a link to this file. It opens only for somebody with a role on this event.'
          : 'Copy the public link to this file.'}
      </TooltipContent>
    </Tooltip>
  )
}
