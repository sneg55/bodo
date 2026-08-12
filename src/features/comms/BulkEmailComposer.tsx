'use client'

// The bulk email composer: an arbitrary subject and body to the speakers an organizer has
// selected. SPK-13, CRM-11.
//
// PRESENTATION IS AUTHORED, NOT TRANSCRIBED. Nothing in sessionboard-refs/ captures a compose
// surface, so there is no parity checklist for this copy and none was invented. The structure
// is borrowed from the drawers next door: a `Sheet` with a header, fields, and a footer, the
// same shape `AdminTemplateSheet` and `FieldEditorSheet` use.
//
// It does NOT confirm in a second dialog, which is a deliberate divergence from
// `InviteSpeakersButton` sitting beside it on the same bulk bar. That control is one click on
// a fixed message, so a confirmation is the only place its recipient count can be shown.
// Getting here means opening a drawer, picking or writing a body, and pressing a button
// labelled with the number of people it will mail; a modal on top of that asks a question the
// organizer has already answered three times. The check that earns its place instead is
// Preview, which renders the real merged messages.
//
// The body is the shared `RichTextEditor`, which is uncontrolled by design: it takes
// `initialHtml` and reports changes, because feeding the value back on every keystroke resets
// the caret. So loading a template REMOUNTS it through `key`, which is the only way to replace
// the document from outside.

import { SendIcon } from 'lucide-react'
import { type ReactNode, useEffect, useState, useTransition } from 'react'
import { toast } from 'sonner'

import { RichTextEditor } from '@/components/primitives/RichTextEditor'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { BulkEmailPreview } from '@/features/comms/BulkEmailPreview'
import {
  type BulkPreviewResult,
  loadBulkStartersAction,
  previewBulkEmailAction,
  sendBulkEmailAction,
} from '@/features/comms/bulk-actions'
import { BULK_MERGE_FIELDS } from '@/features/comms/bulk-compose'
import type { BulkEmailStarter } from '@/features/comms/bulk-starters'
import { isBlankRichText } from '@/features/forms/builder/emptiness'

export function BulkEmailComposer({
  eventId,
  speakerIds,
  onSent,
  scope,
  recipientCount,
}: {
  eventId: string
  speakerIds: readonly string[]
  onSent: () => void
  /**
   * The event picker and its exclusion line, or absent on the single-event roster path.
   *
   * Passed as a rendered SLOT rather than as an event list plus a callback, so this component
   * stays the thing that owns a draft and knows nothing about where its event id came from.
   * The CRM shell owns the picker's state and its resolution, because those are questions
   * about a cross-event selection and not about a message.
   */
  scope?: ReactNode
  /**
   * How many of `speakerIds` would actually be mailed, when that is fewer than all of them.
   *
   * Only the cross-event path can know this, and only it needs to: on the roster every
   * selected id is on the event by construction. Absent means "all of them", and `undefined`
   * while a resolution is in flight means the header and the button say nothing they might
   * have to take back.
   */
  recipientCount?: number
}) {
  const [starters, setStarters] = useState<readonly BulkEmailStarter[]>([])
  const [starterKey, setStarterKey] = useState('')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  // Bumped whenever the document is replaced from outside, and used as the editor's `key`.
  const [documentId, setDocumentId] = useState(0)
  const [preview, setPreview] = useState<BulkPreviewResult | undefined>(undefined)
  const [pending, start] = useTransition()

  // Loaded when the drawer opens rather than shipped in the speakers page payload: the list is
  // only needed by an organizer who has opened this control, and putting it on the page would
  // subscribe the roster to `event:{id}:email-templates` for data most visits never read.
  useEffect(() => {
    let live = true
    void loadBulkStartersAction({ eventId }).then((result) => {
      if (live && result.ok) setStarters(result.starters)
    })
    return () => {
      live = false
    }
  }, [eventId])

  function pickStarter(key: string): void {
    const starter = starters.find((entry) => entry.key === key)
    if (starter === undefined) return
    setStarterKey(key)
    setSubject(starter.subject)
    setBody(starter.bodyHtml)
    setDocumentId((current) => current + 1)
    // The old preview described a different message. Leaving it up is how an organizer sends
    // one body while reading the merge report for another.
    setPreview(undefined)
  }

  function runPreview(): void {
    start(async () => {
      const result = await previewBulkEmailAction({ eventId, speakerIds, subject, bodyHtml: body })
      if (!result.ok) {
        toast.error(result.message)
        return
      }
      const { ok: _ok, ...rest } = result
      setPreview(rest)
    })
  }

  function send(): void {
    start(async () => {
      const result = await sendBulkEmailAction({ eventId, speakerIds, subject, bodyHtml: body })
      if (!result.ok) {
        toast.error(result.message)
        return
      }

      // The three outcomes are genuinely different, the same way the invitation's are. Zero
      // queued is "you already sent this today" and must not read as a send.
      if (result.queued === 0) {
        toast.success('Everyone selected has already been sent this message today')
      } else {
        toast.success(
          result.queued === 1 ? 'Email queued' : `${String(result.queued)} emails queued`,
        )
      }
      if (result.skippedNoEmail > 0) {
        toast.warning(`${String(result.skippedNoEmail)} skipped: no email address on file`)
      }
      // Repeated at the end even though the scope line said it before the send: the two
      // exclusions have different fixes, and this one is the one an organizer acts on by
      // sending again under the other event.
      if (result.notOnEvent > 0) {
        toast.warning(`${String(result.notOnEvent)} skipped: not on the event this was sent under`)
      }
      onSent()
    })
  }

  // The number the header and the button may claim. On the roster it is the selection; on the
  // cross-event path it is what the resolution said, and `undefined` until that comes back,
  // because a control that says "Send to 15" and then mails 12 has misled the one person who
  // could have stopped it.
  const count = recipientCount ?? speakerIds.length
  const counted = scope === undefined || recipientCount !== undefined
  // `isBlankRichText` rather than a length check, matching the server's `assertSendable`: a
  // cleared TipTap document serialises to `<p></p>`, which a truthiness test calls a body.
  const ready = subject.trim() !== '' && !isBlankRichText(body)

  return (
    <>
      <SheetHeader>
        <SheetTitle>Compose email</SheetTitle>
        {/* `tabular-nums`: the count is `undefined` while the cross-event resolution is in
            flight and then lands on a real number, so this sentence rewrites itself under the
            reader. Equal-width digits stop the words after it stepping sideways. */}
        <SheetDescription className="tabular-nums">
          {!counted
            ? 'Working out who this reaches.'
            : count === 1
              ? 'One speaker will receive this message.'
              : `${String(count)} speakers will receive this message.`}{' '}
          Every send is logged per recipient in Email history.
        </SheetDescription>
      </SheetHeader>

      <div className="flex flex-col gap-4 px-4 pb-6">
        {scope}

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="bulk-email-starter">Start from a template</Label>
          <Select
            // `null` and not `''` for "nothing picked", matching `ProfileFields` and
            // `FieldControl`: base-ui renders the raw value when it cannot look a label up,
            // and an empty string is a value no item carries.
            value={starterKey === '' ? null : starterKey}
            items={starters.map((entry) => ({ value: entry.key, label: entry.title }))}
            onValueChange={(next: string | null) => {
              if (next !== null) pickStarter(next)
            }}
          >
            <SelectTrigger id="bulk-email-starter" className="w-full">
              <SelectValue placeholder="Write from scratch" />
            </SelectTrigger>
            <SelectContent>
              {starters.map((entry) => (
                <SelectItem key={entry.key} value={entry.key}>
                  {entry.title}
                  {entry.customized ? ' (customized)' : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-pretty text-muted-foreground">
            Loads a copy of that template. Editing it here changes nothing in Settings, and Email
            history records the send as Hand-composed.
          </p>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="bulk-email-subject">Subject</Label>
          <Input
            id="bulk-email-subject"
            value={subject}
            placeholder="What this email is about"
            onChange={(event) => setSubject(event.target.value)}
          />
        </div>

        <RichTextEditor
          key={documentId}
          id="bulk-email-body"
          label="Message"
          value={body}
          onChange={setBody}
          placeholder="Write your message"
          help={`Merge fields: ${BULK_MERGE_FIELDS.map((field) => `{{${field}}}`).join(' ')}`}
        />

        {preview === undefined ? null : <BulkEmailPreview preview={preview} />}
      </div>

      <SheetFooter>
        <Button variant="outline" onClick={runPreview} disabled={pending || !ready}>
          Preview
        </Button>
        <Button onClick={send} disabled={pending || !ready || !counted || count === 0}>
          <SendIcon data-icon="inline-start" />
          {pending
            ? 'Sending...'
            : `Send to ${String(count)} ${count === 1 ? 'speaker' : 'speakers'}`}
        </Button>
      </SheetFooter>
    </>
  )
}
