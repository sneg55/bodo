// Info-icon copy for the Event Details form.
//
// AUTHORED, NOT TRANSCRIBED. `docs/parity/event-config.md` lists "contents of every
// info-icon tooltip (Slug, Type, Website URL, Location, Timezone, Starts/Ends At)" as its
// first ambiguity: the screenshots show the icons, not what they say. Every other label
// and every piece of section copy on this screen IS verbatim; these are not, and they are
// in their own file so replacing them with the real wording is a one-file diff.
//
// The Slug and Timezone strings carry real warnings rather than restating the label,
// because both are load-bearing outside this page: the slug is in the public URL of the
// CFP form and the public agenda, and the timezone is what every agenda surface and every
// calendar invite renders in.

export const FIELD_HINTS = {
  slug: 'Used in the public links for this event: the call for papers form and the public agenda. Changing it breaks every link you have already shared.',
  eventType: 'How this event is described in listings and exports.',
  websiteUrl: 'Your own event site. Shown to speakers alongside the call for papers.',
  location: 'The city or venue, shown on the public agenda and in calendar invites.',
  timezone:
    'Every session time, agenda view and calendar invite is rendered in this zone. Pick the zone the event runs in, not the one you are in.',
  startsAt: 'The first day of the event. The agenda day tabs start here.',
  endsAt: 'The last day of the event. The agenda day tabs end here.',
  theme: 'A short description of what this event is about.',
} as const
