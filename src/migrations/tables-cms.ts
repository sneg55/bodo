// CmsEmbeds, Dashboards, DashboardWidgets: the two P2 surfaces that had no schema.
//
// Both were the reason their audits read 0 and 11 of 29. Neither needed a big model,
// which is worth saying because both were carried as "expensive" for a whole revision:
// an embed is a name, a locked format, a switchable view and an enabled flag, and a
// dashboard is an ordered set of typed widgets over a closed list of metrics.
//
// Style Options, Filters and Field Options DO have columns now, and the earlier note here
// saying they never could has been withdrawn. Both of our screenshots capture those three
// sections collapsed, but Sessionboard's public changelog carries a screenshot of the panel
// EXPANDED and its knowledge base describes the other two, so the controls, their labels and
// one of their captured values are transcribed rather than invented. The source of record is
// docs/parity/external-references.md, sections "Embed Style Options" and "Embed Filters and
// Field Options".

import {
  checkboxField,
  link,
  longText,
  numberField,
  select,
  type TableSpec,
  text,
} from '@/migrations/schema-types'
import { COL, TABLES } from '@/services/airtable/tables'

/**
 * Ref 33's Format card: the OUTPUT format one embed serves.
 *
 * `styled_html` is the transcribed value and stays the default. The other four are formats the
 * same feed is worth having, and each has a serializer and a public URL behind it
 * (@/features/cms/format-options): a plain HTML document, JSON, XML, and a calendar feed. A
 * format with no endpoint would be a select option that changes nothing.
 *
 * Adding a value here adds an Airtable select option, so `npm run airtable:schema` has to run
 * before an embed can be saved with one: the API refuses an unknown choice on a select column.
 */
export const EMBED_FORMATS = ['styled_html', 'basic_html', 'json', 'xml', 'ical'] as const

/** Ref 33's View selector. One embed serves all five; the selector switches layout. */
export const EMBED_VIEWS = [
  'agenda',
  'session_list',
  'schedule_itinerary',
  'speaker_list',
  'speaker_gallery',
] as const

/**
 * `Website Color Theme`. The captured value is `Light`.
 *
 * Two values and no more. The control is a Select, so it has a closed vocabulary, and the only
 * two a colour theme can defensibly hold are the two the app already has tokens for: `.dark` is
 * the one variant `src/app/globals.css` defines. A third option would be a choice with no
 * stylesheet behind it.
 */
export const EMBED_THEMES = ['light', 'dark'] as const

/**
 * `Date/Time Format`. ONE option label is captured, verbatim:
 * `English (US): Fri, June 3, 2022 at 11:00 PM`.
 *
 * That one is transcribed and `iso` is AUTHORED. Shipping a single-option Select would be a
 * control that cannot be operated, and inventing the other four locales the real product
 * presumably offers would be inventing product rather than cloning it, so the second value is
 * the one that needs no locale research and is unambiguous to every reader.
 */
export const EMBED_DATE_FORMATS = ['en_us_long', 'iso'] as const

/** The dot colour on a dashboard tab (refs 34, 39, 40). */
export const DASHBOARD_COLORS = ['blue', 'orange', 'purple', 'green'] as const

/** The four widget shapes observed across refs 39 and 40. */
export const WIDGET_TYPES = ['stat', 'donut', 'bar', 'top_list'] as const

/**
 * What a widget counts. A closed vocabulary and not a stored query: a query column
 * would be an injection surface into the DAL, and every widget in refs 39 and 40 is a
 * fixed aggregate over submissions, speakers or tasks.
 */
export const WIDGET_METRICS = [
  'accepted_speakers',
  'outstanding_speaker_tasks',
  'speaker_confirmation_mix',
  'top_speakers_by_outstanding_tasks',
  'total_submissions',
  'pending_review',
  'submissions_by_form',
  'submissions_by_track',
] as const

const cmsEmbeds: TableSpec = {
  name: TABLES.cmsEmbeds,
  fields: [
    text(COL.name),
    link(COL.event, TABLES.events),
    // The public URL's identifier. Opaque for the same reason `Forms.publicId` is:
    // an embed URL is pasted into somebody else's website, so it must not leak a
    // record id or be guessable from the event slug.
    text(COL.publicId),
    select(COL.format, EMBED_FORMATS),
    select(COL.view, EMBED_VIEWS),
    checkboxField(COL.enabled),
    // Style Options. `primaryColor` is text and not a select: the captured value is `#1b6ec2`
    // and the control is a swatch plus a free hex input, so the vocabulary is every hex colour.
    // Validation is `isEmbedHex` in @/features/cms/style-options, at both boundaries.
    select(COL.colorTheme, EMBED_THEMES),
    text(COL.primaryColor),
    select(COL.dateTimeFormat, EMBED_DATE_FORMATS),
    // `Extra CSS Code`. longText, and SANITIZED on the way out of the DAL by `mapCmsEmbed`, not
    // on the way in: an event admin is a customer, and this cell is writable straight from the
    // Airtable UI, so a guard at the write boundary guards nothing. See @/features/cms/safe-css.
    longText(COL.extraCss),
    // Filters and Field Options, as blobs. Both are sets of chosen values over dimensions whose
    // members are records on this event (tracks, rooms, tags) or vocabularies that already exist
    // (statuses, formats, languages), so neither is a select and neither is a link: a link would
    // make deleting a track a cascade into every embed that mentioned it.
    longText(COL.filtersJson),
    longText(COL.fieldOptionsJson),
  ],
}

const dashboards: TableSpec = {
  name: TABLES.dashboards,
  fields: [
    text(COL.name),
    link(COL.event, TABLES.events),
    select(COL.color, DASHBOARD_COLORS),
    text(COL.description),
    // Which gallery template instantiated it, so the tab can say so and a reader can
    // tell an instantiated dashboard from one that was edited afterwards.
    text(COL.templateKey),
    numberField(COL.order),
  ],
}

const dashboardWidgets: TableSpec = {
  name: TABLES.dashboardWidgets,
  fields: [
    text(COL.title),
    link(COL.dashboard, TABLES.dashboards),
    select(COL.widgetType, WIDGET_TYPES),
    select(COL.metric, WIDGET_METRICS),
    numberField(COL.order),
  ],
}

export const CMS_TABLES: readonly TableSpec[] = [cmsEmbeds, dashboards, dashboardWidgets]
