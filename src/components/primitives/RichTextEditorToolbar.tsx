'use client'

// The toolbar and the status bar of the shared rich text editor, split out of
// RichTextEditorBody so no file passes the 300-line limit the repo hook enforces. What
// each button IS lives in rich-text-commands.ts; this file is the markup.
//
// Inventory and order come off the reference toolbar verbatim
// (docs/parity/submission-form-builder.md ref 83, docs/parity/portal-tasks-forms.md refs
// 89 and 121): bold, italic, underline, superscript, subscript, link, bulleted list,
// numbered list, outdent, indent, align left, align center, align right, image, `...`
// overflow. The status bar is the block-tag indicator those refs show at bottom left.
//
// The image button inserts BY URL, and disk upload is deliberately not wired: the only
// upload route in this project authorizes with `requireSpeaker()` and keys objects under a
// speaker id, so an organizer editing a form has nothing to post to. Same choice as the
// event settings image dropzone, which offers "Use an image URL" for the same reason.
//
// Active states come from `useEditorState`, not from reading `editor.isActive` during
// render: TipTap 3's `useEditor` does not re-render on transactions by default
// (`shouldRerenderOnTransaction` is off), so a toolbar that reads the editor directly goes
// stale as soon as the caret moves without an edit.

import { type Editor, useEditorState } from '@tiptap/react'
import {
  ImageIcon,
  IndentDecreaseIcon,
  IndentIncreaseIcon,
  LinkIcon,
  type LucideIcon,
  MoreHorizontalIcon,
} from 'lucide-react'
import { useState } from 'react'

import {
  ALIGNMENTS,
  activeNames,
  blockTagOf,
  indent,
  LISTS,
  MARKS,
  OVERFLOW,
  outdent,
  toggleLink,
} from '@/components/primitives/rich-text-commands'
import { safeHttpUrl } from '@/components/primitives/rich-text-html'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Toggle } from '@/components/ui/toggle'
import { cn } from '@/utils/cn'

// Every control here is 28px square, under the 40px minimum hit area, and 40px is
// unreachable: the strip is dense by design and it WRAPS, so neighbours sit `gap-0.5` away
// both across and, once wrapped, down. 30px is the pitch, 28px of button plus half of the
// 2px gap on each of the four sides, so hit areas meet at the gap's midline and never
// overlap. The other 10px would have to come out of the button size, which is a parity item.
const TOOLBAR_HIT = 'hit-area-[30px]'

/**
 * Optical, not geometric, centring for the two asymmetric alignment glyphs.
 *
 * lucide 1.30's `text-align-start` draws its three rows as 3-21, 3-15 and 3-17 in a 24-unit
 * box, so its ink centres average 10.33 against a box centre of 12: the glyph reads 1.67
 * units left of where it sits. `text-align-end` is the mirror, 13.67, the same distance
 * right. At the `size-3.5` the toolbar renders them that is 0.97px, so one pixel each way is
 * the correction. `text-align-center` is 12 on all three rows and gets nothing.
 */
function alignNudge(value: string): string | undefined {
  if (value === 'left') return 'translate-x-px'
  if (value === 'right') return '-translate-x-px'
  return undefined
}

export type RichTextEditorToolbarProps = { editor: Editor | null }

export function RichTextEditorToolbar({ editor }: RichTextEditorToolbarProps) {
  const active = useEditorState({
    editor,
    selector: ({ editor: current }) => (current === null ? [] : activeNames(current)),
  })

  return (
    <div className="flex flex-wrap items-center gap-0.5 border-b border-border p-1">
      {MARKS.map((mark) => (
        <Toggle
          key={mark.name}
          size="sm"
          className={TOOLBAR_HIT}
          pressed={active?.includes(mark.name) === true}
          aria-label={mark.label}
          onPressedChange={() => {
            if (editor !== null) mark.run(editor)
          }}
        >
          <mark.icon />
        </Toggle>
      ))}

      <Toggle
        size="sm"
        className={TOOLBAR_HIT}
        pressed={active?.includes('link') === true}
        aria-label="Link"
        onPressedChange={() => {
          toggleLink(editor)
        }}
      >
        <LinkIcon />
      </Toggle>

      {LISTS.map((list) => (
        <Toggle
          key={list.name}
          size="sm"
          className={TOOLBAR_HIT}
          pressed={active?.includes(list.name) === true}
          aria-label={list.label}
          onPressedChange={() => {
            if (editor !== null) list.run(editor)
          }}
        >
          <list.icon />
        </Toggle>
      ))}

      <ToolbarAction
        label="Outdent"
        icon={IndentDecreaseIcon}
        onClick={() => {
          outdent(editor)
        }}
      />
      <ToolbarAction
        label="Indent"
        icon={IndentIncreaseIcon}
        onClick={() => {
          indent(editor)
        }}
      />

      {ALIGNMENTS.map((alignment) => (
        <Toggle
          key={alignment.value}
          size="sm"
          className={TOOLBAR_HIT}
          pressed={active?.includes(`align:${alignment.value}`) === true}
          aria-label={alignment.label}
          onPressedChange={() => editor?.chain().focus().setTextAlign(alignment.value).run()}
        >
          <alignment.icon className={alignNudge(alignment.value)} />
        </Toggle>
      ))}

      <ImageButton editor={editor} />

      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon"
              className={cn('size-7', TOOLBAR_HIT)}
              aria-label="More options"
            />
          }
        >
          <MoreHorizontalIcon className="size-3.5" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuGroup>
            <DropdownMenuLabel>More formatting</DropdownMenuLabel>
            {OVERFLOW.map((item) => (
              <DropdownMenuItem
                key={item.label}
                onClick={() => {
                  if (editor !== null) item.run(editor)
                }}
              >
                {item.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

/**
 * The block-tag indicator the reference shows at the editor's bottom left. The resize
 * handle it shows at bottom right is the container's own `resize-y`, drawn by the browser.
 */
export function RichTextEditorStatus({ editor }: RichTextEditorToolbarProps) {
  const tag = useEditorState({
    editor,
    selector: ({ editor: current }) => (current === null ? 'p' : blockTagOf(current)),
  })

  return (
    <div className="flex items-center border-t border-border px-2 py-1">
      <span className="font-mono text-[0.7rem] text-muted-foreground">{tag ?? 'p'}</span>
    </div>
  )
}

type ToolbarActionProps = { label: string; icon: LucideIcon; onClick: () => void }

/** An icon button that runs a command rather than reflecting a state, so not a Toggle. */
function ToolbarAction({ label, icon: Icon, onClick }: ToolbarActionProps) {
  return (
    <Button
      variant="ghost"
      size="icon"
      className={cn('size-7', TOOLBAR_HIT)}
      aria-label={label}
      onClick={onClick}
    >
      <Icon className="size-3.5" />
    </Button>
  )
}

function ImageButton({ editor }: RichTextEditorToolbarProps) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const src = safeHttpUrl(draft)

  return (
    <>
      <ToolbarAction
        label="Image"
        icon={ImageIcon}
        onClick={() => {
          setDraft('')
          setOpen(true)
        }}
      />
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Insert image</DialogTitle>
            <DialogDescription>
              Paste the address of an image that is already hosted somewhere public. Uploading a
              file is not in this build.
            </DialogDescription>
          </DialogHeader>
          <Label htmlFor="rich-text-image-url">Image URL</Label>
          <Input
            id="rich-text-image-url"
            value={draft}
            placeholder="https://example.com/banner.png"
            onChange={(event) => {
              setDraft(event.target.value)
            }}
          />
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
            <Button
              disabled={src === undefined}
              onClick={() => {
                if (editor === null || src === undefined) return
                editor.chain().focus().setImage({ src }).run()
                setOpen(false)
              }}
            >
              Use this image
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
