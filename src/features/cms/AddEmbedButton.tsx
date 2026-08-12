'use client'

// Ref 32's primary button: "+ Add Embed" with a dropdown caret.
//
// It is a DropdownMenu and not a plain button because the caret is in the screenshot, and
// docs/parity/cms-embeds.md reads the caret as a format choice: "the editor copy 'Create a new
// embed to use a different format' implies format is chosen at creation time and immutable
// afterward, hence 'Locked'". So the menu lists the formats, and it now lists FIVE: Styled HTML,
// Basic HTML, JSON, XML and iCal, each with a serializer and a public URL behind it
// (./format-options). The menu was already written to iterate `EMBED_FORMATS`, so the four new
// entries cost nothing here.
//
// The menu is the whole trigger rather than a split button with two hit areas. Ref 32 shows one
// blue pill and the parity doc records it as "split/dropdown button", undecided; one target is
// the reading that cannot be wrong.

import { PlusIcon } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useTransition } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { createEmbedAction } from '@/features/cms/actions'
import { EMBED_FORMATS, type EmbedFormat, embedFormatLabel } from '@/types/cms'

export function AddEmbedButton({ eventId }: { eventId: string }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  const create = (format: EmbedFormat) => {
    startTransition(async () => {
      const result = await createEmbedAction(eventId, format)
      if (!result.ok) {
        toast.error(result.message)
        return
      }
      // Straight into the editor, because a new embed is disabled and unnamed: the list would
      // show a card that does nothing yet, and ref 33 is where it is made to do something.
      router.push(`/admin/${eventId}/cms/embeds/${result.embedId}`)
    })
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button className="hit-area-y" disabled={pending} />}>
        <PlusIcon data-icon="inline-start" />
        Add Embed
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {/* Inside a group, because DropdownMenuLabel is Base UI's Menu.GroupLabel and throws
            outside one, which takes the whole route down when the menu opens. */}
        <DropdownMenuGroup>
          <DropdownMenuLabel>Format</DropdownMenuLabel>
          {EMBED_FORMATS.map((format) => (
            <DropdownMenuItem
              key={format}
              onClick={() => {
                create(format)
              }}
            >
              {embedFormatLabel(format)}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
