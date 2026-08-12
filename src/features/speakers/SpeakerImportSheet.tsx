'use client'

// Bulk import speakers from a CSV. SPK-03.
//
// PARSED IN THE BROWSER, IMPORTED ON THE SERVER, and the split is the point: an operator hands
// this a file exported from a system nobody here has seen, so they see the row count and the
// per-line problems BEFORE anything is written. An import that reports its mistakes after the
// fact is one somebody has to undo by hand.
//
// The server does not trust the parse. `importSpeakersAction` re-checks every address and
// every status, because the action is reachable by POST with no page ever rendering.
//
// Paste OR upload, both feeding the same parser. Paste is there because the fastest path from
// a spreadsheet is select-all and copy, and requiring a saved file for that is friction with
// nothing behind it. The file input reads the text in the browser and never uploads anything:
// this is not R2's job, and the bytes are a few kilobytes of text.
//
// The picker is `FileInput` rather than a bare `<Input type="file">`. Both are the shadcn
// input, but the bare one lets the browser paint `Choose File  No file chosen` in the system
// font, which is the one native-looking control in an otherwise themed sheet. The primitive
// keeps the real input for focus, tab order and the label, and draws a `Button` over it.
//
// CREATE AND UPDATE ARE DIFFERENT OUTCOMES AND ARE REPORTED AS SUCH. The import upserts by
// email, so "Imported 3 speakers" was true of three creates, three updates and every mixture
// between - which meant a run that quietly rewrote existing profiles read exactly like one
// that added people. Two things say which now: the preview asks the server which addresses
// already exist and shows `N to create, N to update` with a badge per row, and the run leaves
// a Created / Updated / Failed summary in the sheet rather than a toast that fades.
//
// THE EXISTING-SPEAKER CHECK IS DEBOUNCED and keyed on the parsed addresses, not on the raw
// text. Re-parsing on every keystroke costs nothing on a few kilobytes; asking the server on
// every keystroke would be one `listAll` of the Speakers table per character typed.

import { UploadIcon } from 'lucide-react'
import { useEffect, useState, useTransition } from 'react'
import { toast } from 'sonner'

import { FileInput } from '@/components/primitives/FileInput'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import { Textarea } from '@/components/ui/textarea'
import { planSpeakerImport, type SpeakerImportPlan } from '@/features/speakers/csv-import'
import {
  importSpeakersAction,
  previewSpeakerImportAction,
  type SpeakerImportSummary,
} from '@/features/speakers/import-actions'
import { rowEmails, SpeakerImportPreview } from '@/features/speakers/SpeakerImportPreview'
import { SpeakerImportSummaryPanel } from '@/features/speakers/SpeakerImportSummaryPanel'

/** Shown as the textarea's placeholder, so the expected shape needs no separate docs. */
const SAMPLE = `Email,First Name,Last Name,Company,Status
ada@example.com,Ada,Okafor,Bodo Labs,confirmed`

/** Long enough that typing a row does not fire a request per character. */
const CHECK_DELAY_MS = 400

export function SpeakerImportSheet({
  eventId,
  onImported,
}: {
  eventId: string
  /** Called after a successful import so the roster can re-read. */
  onImported: () => void
}) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [summary, setSummary] = useState<SpeakerImportSummary | undefined>(undefined)
  const [pending, startTransition] = useTransition()

  // Re-parsed on every keystroke rather than on a button press, so the preview and the problem
  // list track what is actually in the box. A CSV an organizer pastes is kilobytes, not
  // megabytes, so this costs nothing worth memoising.
  const plan: SpeakerImportPlan | undefined =
    text.trim() === '' ? undefined : planSpeakerImport(text)

  // A string rather than the array, because an array literal is a new identity every render
  // and would restart the effect forever.
  const emailsKey = plan === undefined ? '' : rowEmails(plan).join('\n')
  const [check, setCheck] = useState<
    { key: string; existing: ReadonlySet<string>; problem?: string } | undefined
  >(undefined)

  useEffect(() => {
    // Nothing to ask about, and nothing to clear either: the answer is keyed on the rows it
    // was asked for, so a stale one is already ignored by `current` below.
    if (emailsKey === '') return
    let live = true
    const timer = setTimeout(() => {
      void previewSpeakerImportAction({ eventId, emails: emailsKey.split('\n') }).then((result) => {
        if (!live) return
        // A failed check is REPORTED and does not block the import: the write matches on
        // email regardless, so the only thing lost is the preview's ability to say which
        // rows are which.
        setCheck(
          result.ok
            ? { key: emailsKey, existing: new Set(result.existing) }
            : { key: emailsKey, existing: new Set<string>(), problem: result.message },
        )
      })
    }, CHECK_DELAY_MS)
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [emailsKey, eventId])

  // Only an answer about the CURRENT rows counts. Anything else is a stale reply to a file
  // that has since been edited, and showing it would be the disagreement the preview exists
  // to prevent.
  const current = check?.key === emailsKey ? check : undefined

  function readFile(event: React.ChangeEvent<HTMLInputElement>): void {
    const file = event.currentTarget.files?.[0]
    if (file === undefined) return
    // Read in the browser and never uploaded: this is a few kilobytes of text and R2 has no
    // business holding it.
    void file.text().then((contents) => {
      setSummary(undefined)
      setText(contents)
    })
  }

  function run(): void {
    if (plan === undefined || plan.rows.length === 0) return
    startTransition(async () => {
      const result = await importSpeakersAction({ eventId, rows: plan.rows })
      if (!result.ok) {
        toast.error(result.message)
        return
      }
      // The counts stay ON THE SHEET rather than in a toast alone. A toast that fades is not
      // a report, and this is the one number an operator re-reads after a bulk write.
      setSummary(result)
      setText('')
      setCheck(undefined)
      toast.success(
        `Created ${String(result.created)} / Updated ${String(result.updated)} / Failed ${String(result.failed.length)}`,
      )
      // Immediately, so the roster behind the sheet already shows the new people while the
      // summary is still being read.
      onImported()
    })
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) setSummary(undefined)
      }}
    >
      <SheetTrigger
        render={
          <Button variant="outline">
            {/* Trips the Button's own optical padding for a leading icon. See
                DataTableToolbar.tsx, which documents the rule. */}
            <UploadIcon data-icon="inline-start" />
            Import CSV
          </Button>
        }
      />
      <SheetContent className="w-full sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>Import speakers</SheetTitle>
          <SheetDescription>
            Matched on email: somebody already on this event is updated rather than added twice. The
            preview says which rows are which.
          </SheetDescription>
        </SheetHeader>

        {/* Scrolls for the reason the edit sheet does: `SheetContent` is a flex column with an
            `mt-auto` footer, so a body left to grow pushes IMPORT off the bottom of the panel
            instead of scrolling. A parse error lists one line per bad row, so the height here
            is not bounded by the markup. See SpeakerEditSheet.tsx. */}
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4">
          {summary === undefined ? null : <SpeakerImportSummaryPanel summary={summary} />}

          <div className="space-y-1.5">
            <Label htmlFor="import-file">CSV file</Label>
            <FileInput id="import-file" accept=".csv,text/csv" onChange={readFile} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="import-text">Or paste rows</Label>
            <Textarea
              id="import-text"
              value={text}
              rows={10}
              placeholder={SAMPLE}
              className="font-mono text-xs"
              onChange={(event) => {
                setSummary(undefined)
                setText(event.target.value)
              }}
            />
          </div>

          {plan === undefined ? null : (
            <SpeakerImportPreview
              plan={plan}
              existing={current?.problem === undefined ? current?.existing : undefined}
              checking={current === undefined}
              problem={current?.problem}
            />
          )}
        </div>

        <SheetFooter>
          <Button disabled={pending || plan === undefined || plan.rows.length === 0} onClick={run}>
            Import
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
