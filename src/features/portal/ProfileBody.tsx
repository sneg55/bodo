// The profile page's dynamic half: the header and the prefilled form.
//
// Ref 18: a large initials avatar with the name and the email, then the `Profile Info`
// control, then the two panels. First and Last Name prefill from the account, which is
// the whole reason this is a server component: the values come off the Speakers record
// and the form is handed strings, so nothing is fetched from the browser.

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { HeadshotUpload } from '@/features/portal/HeadshotUpload'
import { ProfileForm } from '@/features/portal/ProfileForm'
import { portalSession } from '@/features/portal/reads'

export async function ProfileBody() {
  const { speaker, user } = await portalSession()

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-4">
        <Avatar className="size-16">
          {speaker.headshotUrl === undefined ? null : (
            <AvatarImage src={speaker.headshotUrl} alt="" />
          )}
          <AvatarFallback className="text-xl">{user.initials}</AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <p className="truncate text-base font-medium">{user.name}</p>
          <p className="truncate text-sm text-muted-foreground">{user.email}</p>
        </div>
        <div className="ml-auto">
          <HeadshotUpload />
        </div>
      </div>

      <ProfileForm
        values={{
          bio: speaker.bio ?? '',
          salutation: speaker.salutation ?? '',
          firstName: speaker.firstName,
          lastName: speaker.lastName,
          honorific: speaker.honorific ?? '',
          pronouns: speaker.pronouns ?? '',
          gender: speaker.gender ?? '',
          linkedin: speaker.links.linkedin ?? '',
          x: speaker.links.x ?? '',
          facebook: speaker.links.facebook ?? '',
          website: speaker.links.website ?? '',
        }}
      />
    </div>
  )
}
