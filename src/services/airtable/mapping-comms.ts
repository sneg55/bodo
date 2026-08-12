// The mapper for EmailTemplates. BUILD_SPEC 3 and 5.3.
//
// Its own file rather than more of mapping-portal.ts, for the same reason
// mapping-resources.ts is its own file: that one is already at 200-odd lines and is edited
// concurrently. It inherits the three traps every mapper here absorbs (a link is an array,
// a blank field is an absent key, a default is only safe when being wrong about it is
// visible), plus one that is specific to this table and is the whole reason the readers
// below are as forgiving as they are.
//
// That one: pressing `+` in the Airtable grid creates a COMPLETELY BLANK row, and this is a
// table an organizer opens by hand. Every sender maps the whole table to find one key
// (reads-comms.ts), so a mapper that threw on a blank row would turn one stray click into
// `DATA_SHAPE_INVALID` on the acceptance mail for the entire event. `mapResource` can
// afford `text()` on its identity columns because a resource with no title is a page in a
// list nobody can open; a template with no key is a row that silently stops mail.
//
// So nothing here throws on emptiness. What it does instead:
//
//   - `eventId` reads as `''` when the link is blank, and `listByEvent` then drops the row
//     because `'' !== eventId`. A row belonging to no event is not this event's template.
//   - `key` reads as `''`, and `listEmailTemplates` drops those rows: a template with no
//     key cannot be addressed by a sender, so it is not a template yet.
//   - `subject` and `bodyMarkdown` read as `''`, which `resolveTemplate` treats as "no
//     stored template", so the code default sends. A half-written row must not send blank
//     mail (tests/comms-template-resolution.test.ts).
//
// Emptiness is tolerated; the WRONG TYPE is not. A key that arrives as a number or an
// `attachIcs` that arrives as text is a schema drift the organizer cannot see and the
// migration is wrong about, so those still raise and name the record.

import {
  type AirtableRecord,
  checkbox,
  optionalLink,
  optionalText,
  view,
} from '@/services/airtable/records'
import { COL, TABLES } from '@/services/airtable/tables'
import type { EmailTemplate } from '@/types/domain'

export function mapEmailTemplate(record: AirtableRecord): EmailTemplate {
  const source = view(TABLES.emailTemplates, record)
  return {
    id: source.id,
    // Not `requiredLink`. See the header: a blank grid row has no link either, and
    // `listByEvent` already drops a row whose event is not the one being read.
    eventId: optionalLink(source, COL.event) ?? '',
    key: optionalText(source, COL.key) ?? '',
    subject: optionalText(source, COL.subject) ?? '',
    bodyMarkdown: optionalText(source, COL.bodyMarkdown) ?? '',
    // An unchecked Airtable checkbox is absent, and absent means "do not attach an
    // invite", which is the narrower reading of a blank cell.
    attachIcs: checkbox(source, COL.attachIcs),
  }
}
