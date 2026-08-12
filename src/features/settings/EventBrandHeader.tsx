// The event's logo and background, wherever a visitor or a speaker sees the event named.
//
// This component exists because a Codex review found the honest version of a familiar failure:
// Image Settings had a working dropzone, a working URL field, real R2 storage, a verified object
// and a written column, and NOTHING rendered either image. Uploading changed a preview inside the
// settings page and nothing else. `logoUrl` and `backgroundUrl` had no consumer anywhere outside
// the DAL, the migration and the settings form, so the parity item was a control that stored a
// value nothing read, which is exactly what the rest of this build refuses to ship.
//
// Kept deliberately small and layout-agnostic, because it is used by two shells with different
// chrome: the public agenda page and the speaker portal.

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'

/** The two initials shown while there is no logo, from the event's own name. */
function initialsOf(name: string): string {
  const words = name
    .split(/\s+/u)
    .map((word) => word.trim())
    .filter((word) => word.length > 0)
  const letters = words.slice(0, 2).map((word) => word.charAt(0))
  return letters.join('').toUpperCase()
}

export type EventBrand = {
  name: string
  logoUrl?: string
  backgroundUrl?: string
}

/**
 * The logo beside a heading. Renders the initials rather than a gap when there is no logo, so
 * the header does not change shape the moment an organizer uploads one.
 *
 * `Avatar` and not a bare `img`: it already carries the fallback, the rounding and the size
 * tokens, and a hand-rolled `img` with an `onError` would be a second implementation of it.
 */
export function EventLogo({ brand, size = 'md' }: { brand: EventBrand; size?: 'sm' | 'md' }) {
  return (
    <Avatar className={size === 'sm' ? 'size-8' : 'size-12'}>
      {brand.logoUrl === undefined ? null : <AvatarImage src={brand.logoUrl} alt={brand.name} />}
      <AvatarFallback className="font-heading text-xs font-semibold">
        {initialsOf(brand.name)}
      </AvatarFallback>
    </Avatar>
  )
}

/**
 * The background band behind a page header, drawn only when there is one.
 *
 * A `background-image` on a wrapper rather than an `<img>`: the recommended size the settings
 * page states is 1500 x 500, which is a banner crop and not a picture with its own aspect ratio
 * to preserve. Absent means no band at all, not an empty grey strip.
 */
export function EventBanner({ brand, children }: { brand: EventBrand; children: React.ReactNode }) {
  if (brand.backgroundUrl === undefined) return <>{children}</>

  return (
    <div className="overflow-hidden rounded-xl border border-border">
      <div
        className="h-28 bg-muted bg-cover bg-center sm:h-36"
        // The one inline style in this component, and it has to be inline: the URL is per-event
        // data, so it cannot be a Tailwind class. `role="img"` with a label would announce a
        // decorative crop to a screen reader as if it carried information.
        style={{ backgroundImage: `url(${JSON.stringify(brand.backgroundUrl)})` }}
      />
      <div className="bg-card p-4 sm:p-6">{children}</div>
    </div>
  )
}
