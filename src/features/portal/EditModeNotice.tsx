// The banner that says which of the three edit modes a submission is in.
//
// BUILD_SPEC 5.2 asks for this in as many words: "The page states which of the three
// modes it is in rather than just disabling controls." A disabled input tells a speaker
// that something is not working; this tells them why, and what is still theirs to
// change. The wording is authored, because the detail page is uncaptured.

import { LockIcon, PencilIcon, SendIcon } from 'lucide-react'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import type { EditPermission } from '@/features/portal/edit-mode'

/** Finished elements in a Map: pulling a component out of a lookup during render
    trips `react-hooks/static-components`, and a computed index into a plain object
    trips the security lint. */
const MODE_ICONS = new Map([
  ['full', <PencilIcon key="full" />],
  ['body_updates', <SendIcon key="body_updates" />],
  ['body_locked', <LockIcon key="body_locked" />],
])

export function EditModeNotice({ permission }: { permission: EditPermission }) {
  return (
    <Alert className={permission.bodyEditable ? undefined : 'bg-muted'}>
      {MODE_ICONS.get(permission.mode)}
      <AlertTitle>{permission.title}</AlertTitle>
      <AlertDescription>{permission.detail}</AlertDescription>
    </Alert>
  )
}
