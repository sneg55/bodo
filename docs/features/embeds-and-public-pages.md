# Embeds and public pages

Getting the programme onto the event's own website without anybody copying it by hand.

## The public event site

`/agenda/<event-slug>` plus four pages under it:

| Path | What it shows |
|---|---|
| `/agenda/<slug>` | The event, its dates, and the agenda |
| `/agenda/<slug>/sessions` | The session list |
| `/agenda/<slug>/schedule` | The schedule itinerary |
| `/agenda/<slug>/speakers` | The speaker list |
| `/agenda/<slug>/gallery` | The speaker gallery |

Mobile-friendly, no login, and every one of them reads **published** rows only. A scheduled
but unpublished session is invisible here, which is what makes it safe to build a draft grid
in the open.

The site is listed in `/sitemap.xml`.

## Embeds

`/admin/<event>/cms/embeds` builds an embeddable view of the same data for an external site.

An embed is a saved configuration. Five **views**:

- Agenda
- Session List
- Schedule Itinerary
- Speaker List
- Speaker Gallery

and five **formats**:

| Format | For |
|---|---|
| `styled_html` | Drop into a page and it looks finished |
| `basic_html` | Inherit the host site's CSS |
| `json` | Feed a static site generator or an app |
| `xml` | Feed something older |
| `ical` | Subscribe to the schedule in a calendar |

Plus a light or dark theme, a date format, filters (by track, by day, by room), and field
options that pick which fields appear on the agenda, speaker and session cards.

The editor previews live and the preview carries its own unsaved view, so an organizer can
look at Speaker Gallery without committing the embed to it.

**Get Code** emits an `<iframe>` and the raw URL, deliberately with no `<script>` tag: an
embed that runs script on somebody else's site is a liability neither party needs.

Addressing is one scheme, a file extension on the public id:

```
/embed/<publicId>        styled HTML, the iframe page
/embed/<publicId>.html   basic HTML: one document, no CSS and no JavaScript
/embed/<publicId>.json   the same feed as JSON
/embed/<publicId>.xml    the same feed as XML
/embed/<publicId>.ics    the sessions as a calendar
```

A suffix rather than `?format=` or content negotiation, for three reasons: it is what a
reader guesses first, so the feed is discoverable from the HTML URL alone; it survives being
pasted into a calendar client, which subscribes to a URL and sends no useful `Accept` header;
and it leaves the query string free for the deep-link parameters, which apply to every format
identically.

## Portal resources

The same HTML-embed capability exists inside the speaker portal: resource pages an organizer
writes, with rich text and embedded content, for venue information, AV guidance and travel
policy. `/admin/<event>/resources` authors them; `/portal/resources` reads them. Pages are
addressed by slug.

## Public speaker profiles

A published speaker has a public profile with their bio, headshot and sessions, sanitized on
the read: speaker-authored HTML is rendered through a sanitizer rather than trusted, and the
same projection feeds the gallery, the modal and the feeds.

## Where the logic lives

| Concern | File |
|---|---|
| Embed configuration and defaults | `src/types/cms.ts`, `src/migrations/tables-cms.ts` |
| Editor, preview and Get Code | `src/features/cms/Embed*.tsx` |
| Rendered views | `src/features/cms/` view components |
| Public projection, shared with the API | `src/features/agenda/public-agenda.ts` |
| Sanitized speaker HTML | `src/components/primitives/SpeakerHtml.tsx` |
