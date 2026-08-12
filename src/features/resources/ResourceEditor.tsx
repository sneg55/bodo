'use client'

// The resource page editor: settings on the left, live embed preview on the right.
//
// PRESENTATION. The two-pane shape and the live preview come from ref 33 in
// `docs/parity/cms-embeds.md` (a settings panel, a preview panel, a `Name` field with a
// required asterisk, an `Enabled` label with a toggle). Only the shape is borrowed: that
// surface is P2 and SPEC.md line 44 defers every P2 item, and the thing it edits is an
// agenda feed rather than a portal page, so its Format card, Style Options, Filters, Field
// Options, Get Code tab and device toggle are all absent here. The field set below is R8's:
// title, slug, body, embed, visibility, ordering. Labels are authored, because no parity
// doc covers this surface.
//
// The preview is the SAME `ResourceEmbed` the portal renders, not a lookalike. That is the
// point: an organizer previews the actual sandboxed frame, so an embed that will not run
// for a speaker does not run here either. Only the embed is previewed live; the markdown
// body is not, because rendering it would pull marked into the client bundle for every
// keystroke, and the body has no isolation behaviour worth previewing.

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { toast } from 'sonner'

import { ButtonLink } from '@/components/primitives/ButtonLink'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { saveResourceAction } from '@/features/resources/actions'
import { hasEmbed } from '@/features/resources/embed'
import type { ResourceFormValues } from '@/features/resources/form'
import { ResourceEmbed } from '@/features/resources/ResourceEmbed'

/**
 * The visibility vocabulary as `value -> label`, feeding the options AND the trigger.
 *
 * One map rather than two literals, because those were the halves that drifted: the open
 * list read "Portal" while the closed trigger read `portal`.
 */
const VISIBILITIES: Record<string, string> = { portal: 'Portal', public: 'Public' }

export type ResourceEditorProps = {
  eventId: string
  /** Absent for a new page. */
  resourceId?: string
  values: ResourceFormValues
}

export function ResourceEditor({ eventId, resourceId, values }: ResourceEditorProps) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [title, setTitle] = useState(values.title)
  const [embedHtml, setEmbedHtml] = useState(values.embedHtml)

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    startTransition(async () => {
      const result = await saveResourceAction(eventId, resourceId, formData)
      if (!result.ok) {
        toast.error(result.message)
        return
      }
      toast.success('Saved successfully', { description: result.message })
      // A create has to land on the record's own URL, or a second save would create a
      // second page. An edit refreshes so a de-duplicated slug is shown as stored.
      if (resourceId === undefined)
        router.replace(`/admin/${eventId}/resources/${result.resourceId}`)
      else router.refresh()
    })
  }

  return (
    <form onSubmit={handleSubmit} className="flex min-w-0 flex-col gap-4">
      <header className="flex flex-wrap items-center gap-3">
        <ButtonLink href={`/admin/${eventId}/resources`} variant="ghost">
          Back to resources
        </ButtonLink>
        <h1 className="min-w-0 flex-1 truncate font-heading text-xl font-semibold">
          {resourceId === undefined ? 'New resource page' : title}
        </h1>
        <Button type="submit" disabled={pending}>
          {pending ? 'Saving' : 'Save'}
        </Button>
      </header>

      <div className="grid min-w-0 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Page</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Field htmlFor="title" label="Title" required>
              <Input
                id="title"
                name="title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                maxLength={255}
                required
              />
            </Field>

            <Field
              htmlFor="slug"
              label="URL slug"
              hint="Leave blank to build one from the title. A slug already in use gets a number added."
            >
              <Input id="slug" name="slug" defaultValue={values.slug} maxLength={60} />
            </Field>

            <Field
              htmlFor="bodyMarkdown"
              label="Body"
              hint="Markdown: headings, lists, links, quotes and code. HTML here is ignored; use the embed below."
            >
              <Textarea
                id="bodyMarkdown"
                name="bodyMarkdown"
                defaultValue={values.bodyMarkdown}
                rows={12}
                className="font-mono text-xs"
              />
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field htmlFor="visibility" label="Visibility">
                {/* `items` is what makes the closed trigger read "Portal" rather than the
                    stored `portal`: Base UI's Select.Value prints the raw value without it. */}
                <Select name="visibility" items={VISIBILITIES} defaultValue={values.visibility}>
                  <SelectTrigger id="visibility">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(VISIBILITIES).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>

              <Field htmlFor="order" label="Order">
                <Input
                  id="order"
                  name="order"
                  type="number"
                  min={0}
                  step={1}
                  defaultValue={values.order}
                />
              </Field>
            </div>

            <div className="flex items-center justify-between gap-3 rounded-md border border-border p-3">
              <div>
                <Label htmlFor="enabled">Enabled</Label>
                <p className="text-xs text-muted-foreground">
                  Off keeps the page a draft. Only enabled pages appear in the portal.
                </p>
              </div>
              <Switch id="enabled" name="enabled" defaultChecked={values.enabled} />
            </div>
          </CardContent>
        </Card>

        <Card className="min-w-0">
          <CardHeader>
            <CardTitle className="text-base">HTML embed</CardTitle>
          </CardHeader>
          <CardContent className="min-w-0 space-y-4">
            <Field
              htmlFor="embedHtml"
              label="Embed HTML"
              hint="Pasted markup runs in a sandboxed frame with no access to the portal session. Scripts and iframes are allowed."
            >
              <Textarea
                id="embedHtml"
                name="embedHtml"
                value={embedHtml}
                onChange={(event) => setEmbedHtml(event.target.value)}
                rows={8}
                className="font-mono text-xs"
              />
            </Field>

            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">Preview</p>
              {hasEmbed(embedHtml) ? (
                <ResourceEmbed html={embedHtml} resourceTitle={title} />
              ) : (
                <p className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                  Paste embed HTML to preview it
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </form>
  )
}

function Field({
  htmlFor,
  label,
  hint,
  required = false,
  children,
}: {
  htmlFor: string
  label: string
  hint?: string
  required?: boolean
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor}>
        {label}
        {required ? <span className="text-destructive">*</span> : null}
      </Label>
      {children}
      {hint === undefined ? null : <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}
