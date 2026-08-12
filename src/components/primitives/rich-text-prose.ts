// The one prose class list for stored rich text, shared by both sinks that render it.
//
// Split out of `OrganizerHtml` when `SpeakerHtml` was added beside it. Two sinks with two
// copies of this string is how a heading ends up sized differently on a public embed than
// in the portal, and nobody notices until a screenshot comparison.

export const RICH_TEXT_PROSE =
  'prose-sm max-w-none [&_a]:text-primary [&_a]:underline [&_h1]:mb-2 [&_h1]:text-2xl [&_h1]:font-semibold [&_h2]:mt-4 [&_h2]:mb-2 [&_h2]:text-lg [&_h2]:font-semibold [&_li]:my-1 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-2 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5'
