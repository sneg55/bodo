'use client'

// `+ Create Portal`, the vendor's own label, and the four-step flow behind it: name,
// filters, review, content. BUILD_SPEC 5.0c.
//
// Step one is `Name`, not `Name and type`. It carried the longer title while offering no
// type control at all, so the rail promised a choice that was never on the screen; the only
// kind this wizard creates is a Contacts Portal, which the step says in a line under the
// field. Renaming the step was the fix rather than adding a picker: `groups` needs the
// sponsors and exhibitors module, which is not part of this build.
//
// THE REVIEW STEP IS NOT OPTIONAL. A filter that matches nobody is the failure mode of this
// whole feature and it is invisible from the admin side, where a portal targeting everybody
// and one targeting nobody render identically; the only person who finds out is the speaker
// who never receives their tasks. So the step lists the people who match, by name, rather
// than printing a count: forty of the wrong people looks exactly like forty of the right
// ones when all you show is `40`.
//
// It still does not BLOCK on an empty match, and that is deliberate. Filters over session
// fields legitimately match nobody before the call for papers closes, and a wizard that
// refuses to finish would send an organizer away to widen a rule that was correct. It warns
// instead, in the place they are about to click Create.
//
// The preview is computed in the browser from the contacts the page already handed down,
// through the same `matchesFilters` the server matches with. That is what `contacts.ts` was
// built flat for: previewing over 400 contacts is array work, so it updates on every
// keystroke instead of a round trip per edit.
//
// `gate: { mode: 'gated' }`, because this CREATES rather than edits: the form editor's rail
// is free because every step of an existing record is reachable, and a half-built portal is
// not a record anybody should be able to skip to the end of.

import dynamic from 'next/dynamic'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { toast } from 'sonner'

import { StepWizard, type StepWizardStep } from '@/components/primitives/StepWizard'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { savePortalAction, savePortalItemsAction } from '@/features/portal-config/actions'
import { denseOrder, isExposed, type PortalContent } from '@/features/portal-config/content'
import { createPortalGate } from '@/features/portal-config/create-gate'
import { matchesFilters } from '@/features/portal-config/match'
import { settled } from '@/features/portal-config/settled'
import type { PortalContact, PortalContactType, PortalFilterRule } from '@/types/portals'
import { PORTAL_ITEM_TYPES } from '@/types/resources'
import { MatchReview } from './MatchReview'
import { type FilterOption, PortalFilterEditor } from './PortalFilterEditor'
import {
  PORTAL_ITEM_KINDS,
  portalContentRows,
  portalItemWrites,
  withPortalContentRows,
} from './portal-item-kinds'

// Behind `next/dynamic` for the reason the editor page does the same: the cards carry
// @dnd-kit, imported at the component that needs it and never at a layout. Here it also
// keeps a drag library off the list screen for anyone who never opens this dialog.
const PortalContentCard = dynamic(
  () => import('./PortalContentCard').then((module) => module.PortalContentCard),
  { ssr: false, loading: () => <Skeleton className="h-64 w-full rounded-xl" /> },
)

const STEPS: readonly StepWizardStep[] = [
  { id: 'setup', title: 'Name', subtitle: 'What this portal is called' },
  { id: 'filters', title: 'Filters', subtitle: 'Who lands here' },
  { id: 'review', title: 'Review', subtitle: 'Who matches right now' },
  { id: 'content', title: 'Content', subtitle: 'What it exposes' },
]

/** One contact plus the name to print. `PortalContact` carries only what a filter can test. */
export type PortalPreviewContact = { name: string; contact: PortalContact }

export type CreatePortalWizardProps = {
  eventId: string
  tracks: readonly FilterOption[]
  tags: readonly FilterOption[]
  contacts: readonly PortalPreviewContact[]
  /** Every record on the event, per kind, at the exposure a brand-new portal starts with. */
  catalog: PortalContent
}

/** A new portal has no `PortalItems` rows, so every switch starts at the kind's default. */
function freshContent(catalog: PortalContent): PortalContent {
  return PORTAL_ITEM_TYPES.reduce<PortalContent>(
    (content, itemType) =>
      withPortalContentRows(
        content,
        itemType,
        denseOrder(
          portalContentRows(catalog, itemType).map((row) => ({
            ...row,
            item: undefined,
            enabled: isExposed(itemType, undefined),
          })),
        ),
      ),
    catalog,
  )
}

export function CreatePortalWizard({
  eventId,
  tracks,
  tags,
  contacts,
  catalog,
}: CreatePortalWizardProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const [step, setStep] = useState('setup')
  const [name, setName] = useState('')
  const [contactTypes, setContactTypes] = useState<readonly PortalContactType[]>([])
  const [rules, setRules] = useState<readonly PortalFilterRule[]>([])
  const [rows, setRows] = useState(() => freshContent(catalog))

  const filters = { contactTypes, rules }
  const matched = contacts.filter((entry) => matchesFilters(filters, entry.contact))

  // Per step, and gated on two things rather than on the name alone. What it gates and why
  // each one: features/portal-config/create-gate.ts.
  const { completed, blockers, canSubmit } = createPortalGate({ name, rules })

  function create(): void {
    setPending(true)
    void (async () => {
      try {
        const saved = await settled(
          savePortalAction({
            eventId,
            name,
            filters,
            // The two switches live on the editor, per §5.0c, so a new portal takes the
            // vendor's own defaults: tasks appear when there are tasks, and a speaker may
            // fix their own profile. Neither exposes anything they were not already
            // assigned.
            alwaysShowTasks: false,
            manageProfile: true,
          }),
        )
        if (!saved.ok || saved.portalId === undefined) {
          toast.error(saved.ok ? 'The portal was created without an id.' : saved.error)
          return
        }

        const writes = portalItemWrites(rows)
        const items =
          writes.length === 0
            ? { ok: true as const }
            : await settled(
                savePortalItemsAction({ eventId, portalId: saved.portalId, rows: writes }),
              )
        if (!items.ok) {
          toast.error(items.error, { description: 'The portal itself was created.' })
        } else {
          toast.success('Saved successfully', { description: `${name} was created.` })
        }
        setOpen(false)
        router.push(`/admin/${eventId}/portals/${saved.portalId}`)
      } finally {
        // In `finally`, and that is the whole point. `setPending(false)` used to sit on each
        // branch, so anything that threw before them left the dialog pending for good: the
        // button stayed disabled, no toast appeared, and a second click sent nothing. Every
        // await above goes through `settled`, so nothing should reach here by throwing, but
        // the reset does not depend on that being true.
        setPending(false)
      }
    })()
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button />}>+ Create Portal</DialogTrigger>

      <DialogContent className="max-h-[85vh] gap-4 overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Create Portal</DialogTitle>
          <DialogDescription>
            Contacts are assigned to the first portal they match. A new one goes last in that order,
            so it cannot take anybody away from a portal you already tuned.
          </DialogDescription>
        </DialogHeader>

        <StepWizard
          steps={STEPS}
          current={step}
          onCurrentChange={setStep}
          gate={{ mode: 'gated', completed }}
          // Both were supported by the primitive and passed by nobody. Without `blockers`
          // the gate above is drawn and never explained, which its own doc calls the worst
          // version of a gate; without `busy` the rail and Back stay live through the
          // create, so a step change could land mid-write.
          blockers={blockers}
          busy={pending}
          label="PORTAL SETUP"
          secondaryAction={
            <Button
              variant="ghost"
              onClick={() => {
                setOpen(false)
              }}
            >
              Cancel
            </Button>
          }
          finalAction={
            // `canSubmit` is the rail's own two conditions, applied here because this
            // button REPLACES Continue on the last step and so is not covered by the gate.
            // Reachable: arrive at Content, go back, empty a filter, return via the rail.
            <Button disabled={pending || !canSubmit} onClick={create}>
              + Create Portal
            </Button>
          }
        >
          {step === 'setup' ? (
            <div className="flex max-w-md flex-col gap-1.5">
              <Label htmlFor="new-portal-name">Name</Label>
              <Input
                id="new-portal-name"
                value={name}
                placeholder="Workshop leads"
                onChange={(event) => {
                  setName(event.target.value)
                }}
              />
              {/* Ended "Groups Portals need the sponsors and exhibitors module, which is not
                  part of this build" until 2026-08-10. This wizard offers no kind picker at
                  all, so the sentence introduced a second kind of portal for the sole purpose
                  of saying it was unavailable. What remains says what this wizard creates. */}
              <p className="text-xs text-muted-foreground">A Contacts Portal.</p>
            </div>
          ) : null}

          {step === 'filters' ? (
            <PortalFilterEditor
              contactTypes={contactTypes}
              onContactTypesChange={setContactTypes}
              rules={rules}
              onRulesChange={setRules}
              tracks={tracks}
              tags={tags}
            />
          ) : null}

          {step === 'review' ? <MatchReview matched={matched} total={contacts.length} /> : null}

          {step === 'content' ? (
            <div className="flex flex-col gap-4">
              {PORTAL_ITEM_KINDS.map((kind) => (
                <PortalContentCard
                  key={kind.itemType}
                  eventId={eventId}
                  itemType={kind.itemType}
                  rows={portalContentRows(rows, kind.itemType)}
                  onChange={(next) => {
                    setRows(withPortalContentRows(rows, kind.itemType, next))
                  }}
                  disabled={pending}
                  // Nothing in this dialog is written yet, so a same-tab link out of a card
                  // discarded the whole draft. PortalContentCard.tsx explains the prop.
                  openInNewTab
                />
              ))}
            </div>
          ) : null}
        </StepWizard>
      </DialogContent>
    </Dialog>
  )
}
