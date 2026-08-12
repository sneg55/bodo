'use client'

// A file picker that looks like the rest of the app.
//
// `<Input type="file">` passes the shadcn rule, because it IS the shadcn input, but it
// renders the browser's own control: Chrome draws `Choose File  No file chosen` in the
// system font inside our bordered box, and `input.tsx` only strips that button's border
// and background rather than replacing it. On /portal that native chrome appeared nine
// times in a row, which is the single most hand-rolled-looking thing in the product.
//
// shadcn has no file-upload component to install, so this composes one out of the parts
// it does have, and it is the only place that knows how:
//
//   - The real `<Input type="file">` is still the control. It is not `display: none`,
//     so a `<Label htmlFor>` at the call site still opens the picker, it still takes
//     focus in tab order, and it still posts as a form field. Everything that makes a
//     native file input work is intact; only its painting is taken over.
//   - The visible `Button` is decoration: `aria-hidden` and out of tab order, forwarding
//     its click to the input. A screen reader hears one file input, not a button next to
//     one, and the focus ring is drawn on the button through `peer-focus-visible` so the
//     keyboard path is still visible.
//   - Hiding uses `absolute size-px p-0 opacity-0` rather than `sr-only`, because
//     `sr-only` and the input's own `h-8 w-full` are both single-class rules that
//     tailwind-merge does not treat as conflicting, so which one won would come down to
//     stylesheet order. `size-px` and `p-0` conflict with `h-8 w-full` and `px-2.5 py-1`
//     by name, so they win deterministically.

import { PaperclipIcon } from 'lucide-react'
import type * as React from 'react'
import { useId, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/utils/cn'

export type FileInputProps = {
  /** Wire this to the call site's `<Label htmlFor>`; one is generated if omitted. */
  id?: string
  /** Set it when the file should post with a `<form action={...}>` rather than upload on change. */
  name?: string
  accept?: string
  disabled?: boolean
  /** Applied to the row, not to the hidden input. */
  className?: string
  /** Ref 17 and 18 both label this control `Choose file`. */
  buttonLabel?: string
  /** Shown until a file is picked. */
  placeholder?: string
  onChange: React.ChangeEventHandler<HTMLInputElement>
}

export function FileInput({
  id,
  name,
  accept,
  disabled = false,
  className,
  buttonLabel = 'Choose file',
  placeholder = 'No file chosen',
  onChange,
}: FileInputProps) {
  const generatedId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const [filename, setFilename] = useState<string>()

  function handleChange(event: React.ChangeEvent<HTMLInputElement>) {
    // Read before delegating: the handler below may upload and then re-render, and the
    // name is what this row shows in the meantime.
    setFilename(event.currentTarget.files?.[0]?.name)
    onChange(event)
  }

  return (
    <div className={cn('relative flex min-w-0 items-center gap-2', className)}>
      <Input
        ref={inputRef}
        id={id ?? generatedId}
        name={name}
        type="file"
        accept={accept}
        disabled={disabled}
        onChange={handleChange}
        className="peer absolute inset-y-0 left-0 size-px border-0 p-0 opacity-0"
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled}
        // Decoration in front of the real input, so it is neither announced nor tabbed
        // to. The ring below is the input's focus ring, drawn where it can be seen.
        aria-hidden
        tabIndex={-1}
        className="peer-focus-visible:border-ring peer-focus-visible:ring-3 peer-focus-visible:ring-ring/50"
        onClick={() => {
          inputRef.current?.click()
        }}
      >
        <PaperclipIcon />
        {buttonLabel}
      </Button>
      <span
        className={cn(
          'min-w-0 truncate text-sm',
          filename === undefined ? 'text-muted-foreground' : 'text-foreground',
        )}
      >
        {filename ?? placeholder}
      </span>
    </div>
  )
}
