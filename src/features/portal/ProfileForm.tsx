'use client'

// The profile editor: the `General` and `My Links` panels inside one form.
//
// One form around both panels rather than one per panel, because ref 18 shows no Save
// control inside either and the parity audit flags "presence and label of a Save button"
// as below the fold. One save for the whole profile is the smaller assumption: it cannot
// half-save, whereas two forms can leave a speaker's name updated and their links lost.
//
// Ref 18 also shows a `Profile Info` control above the panels. It is rendered as a single
// tab, because the audit's own inference is that other tabs may exist for events with
// custom profile forms, and one tab is what today's data supports.

import { useTransition } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { saveProfileAction } from '@/features/portal/actions'
import { GeneralFields, LinkFields, type ProfileValues } from '@/features/portal/ProfileFields'
import { ProfilePanel } from '@/features/portal/ProfilePanel'
import { useHydrated } from '@/features/portal/use-hydrated'

export function ProfileForm({ values }: { values: ProfileValues }) {
  const [pending, startTransition] = useTransition()
  // The save is a submit HANDLER and this form has no `action` to fall back to, so pressing
  // Save before React attaches it does nothing whatsoever. Until then the control says
  // `Loading` and refuses the press, rather than looking ready and eating it: a first click
  // that produces no request, no state and no message is the defect ./use-hydrated.ts
  // records, and it was reported from the network log of a real session.
  const ready = useHydrated()

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    startTransition(async () => {
      const result = await saveProfileAction(formData)
      // `Saved successfully` / `Your changes have been saved.` is the toast pair the
      // parity docs record for a save elsewhere in the product (BUILD_SPEC 5.6), so the
      // portal uses the same one rather than inventing a second phrasing.
      if (result.ok) toast.success('Saved successfully', { description: result.message })
      else toast.error(result.message)
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Tabs value="info">
        <TabsList variant="line">
          <TabsTrigger value="info">Profile Info</TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <ProfilePanel title="General">
            <GeneralFields values={values} />
          </ProfilePanel>
        </div>
        <div>
          <ProfilePanel title="My Links">
            <LinkFields values={values} />
          </ProfilePanel>
        </div>
      </div>

      <div className="flex justify-end">
        {/* 32px tall, wide enough already, and the grid above it is 16px away, so the band
            takes 4px each way and reaches nothing. */}
        <Button
          type="submit"
          className="hit-area-y"
          disabled={pending || !ready}
          aria-busy={pending || !ready}
        >
          {saveLabel({ pending, ready })}
        </Button>
      </div>
    </form>
  )
}

/**
 * `Save` is the transcribed label (ref 18) and it is what the control reads whenever it can
 * actually save. The other two states are not decoration: `Loading` is the only honest thing
 * to call a button whose handler does not exist yet, and `Saving` is the one already here.
 */
function saveLabel(state: { pending: boolean; ready: boolean }): string {
  if (state.pending) return 'Saving'
  return state.ready ? 'Save' : 'Loading'
}
