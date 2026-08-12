// `EmailTemplates.bodyMarkdown` to the HTML an email body needs.
//
// **The stored template is MARKDOWN, and that is a decision, not an accident of the column
// name.** The builder's other body editors (`Forms.welcomeHtml`, `successHtml`,
// `confirmationEmailHtml`) are TipTap and store HTML, so this is the one place in the
// project where an authored body is not HTML, and it is worth being explicit about why:
//
//   1. The column on the live base is called `bodyMarkdown` and BUILD_SPEC 3 declares it
//      as markdown. Storing HTML in it would make the schema lie about its own contents,
//      and the next reader of that table has no way to tell which of the two it is holding.
//      There is already a precedent for the honest reading: `Resources.bodyMarkdown` is
//      markdown authored in a plain Textarea (@/features/resources/markdown).
//   2. A template body is not free-form prose, it is prose plus `{{merge.fields}}`. TipTap
//      is free to normalise, wrap and re-escape what it is given, and a merge field that
//      comes back as `{{speaker.<span>firstName</span>}}` fails the render at send time,
//      which is a failure an organizer only discovers from the outbox.
//
// So the two admin templates are authored in a Textarea and stored as markdown, and the
// submitter confirmation stays TipTap over `Forms.confirmationEmailHtml`, because that
// column is HTML, is what the CFP path already reads, and moving it would be a storage
// change nothing asked for.
//
// ORDER MATTERS HERE and it is the reason this is a separate step from `renderTemplate`.
// Markdown is converted FIRST, then the merge fields are substituted into the resulting
// HTML. The other way round, a speaker whose company is "Acme *Labs*" would have their own
// text interpreted as markdown, and `renderTemplate`'s escaping would already have turned
// `&` into `&amp;` before marked saw it, which marked then escapes again.
//
// Raw HTML in the markdown passes through, deliberately. The author is an event organizer
// who can already store raw HTML in `confirmationEmailHtml` through the rich text editor,
// so this table is not a lower trust level than the ones next to it. The dangerous half is
// the untrusted half, and that is the merge VALUES: those go through `renderTemplate`,
// which escapes every one of them (@/features/comms/templates).
//
// Workers-safe: `marked` is pure JavaScript with no `fs` and no `Buffer`.

import { marked } from 'marked'

/**
 * Convert one stored body to HTML.
 *
 * `async: false` is passed explicitly so the return type is a string rather than
 * `string | Promise<string>`: marked only returns a promise when an extension asks it to,
 * and there are no extensions here. Rendering a body must stay synchronous, because it
 * happens inside the loop that builds one outbox row per recipient.
 */
export function emailHtmlFromMarkdown(bodyMarkdown: string): string {
  const html = marked.parse(bodyMarkdown, { async: false, gfm: true, breaks: true })
  // The overload above narrows to `string`; this keeps that guarantee at runtime rather
  // than trusting a cast, since a promise reaching `payloadJson` would stringify to
  // "[object Promise]" and mail an empty body.
  return typeof html === 'string' ? restoreMergeTokens(html) : ''
}

/** A percent-encoded `{{ ... }}`, which is what a merge token in a link destination becomes. */
const ENCODED_TOKEN = /%7B%7B([a-zA-Z0-9_.%]*?)%7D%7D/gu

/**
 * Put back the merge tokens that the markdown converter percent-encoded.
 *
 * THE BUG THIS FIXES was silent and shipped in two built-in templates. `marked` treats a
 * link destination as a URL and encodes it, so `[{{portalUrl}}]({{portalUrl}})` came out as
 * `<a href="%7B%7BportalUrl%7D%7D">{{portalUrl}}</a>`. Substitution runs afterwards, over
 * the HTML, and matches on `{{...}}`: the anchor TEXT was replaced and the href was not,
 * because the encoded form no longer looked like a token. The mail therefore rendered
 * perfectly, read correctly, and linked nowhere, which is the worst shape a defect can take
 * because nothing about it looks wrong to the person who sent it.
 *
 * Done AFTER conversion rather than by substituting first. That order is deliberate and the
 * top of this file explains it: merging first would feed a speaker's own text ("Acme
 * *Labs*") through the markdown parser, and double-escape values `renderTemplate` has
 * already escaped.
 *
 * Done as a decode rather than by overriding marked's link renderer, because an override
 * has to reproduce the rest of that renderer (titles, escaping, the null-href case) in
 * order to change one thing about it, and a partial renderer object replaces the whole set
 * rather than merging into it. This touches only the sequence marked itself emitted.
 *
 * The false-positive case is an author writing a literal `%7B%7B` that was never a token.
 * It fails LOUDLY if that ever happens: substitution throws `MAIL_MERGE_FIELD_UNKNOWN`
 * naming the field, which is the opposite of the failure being fixed here.
 */
function restoreMergeTokens(html: string): string {
  return html.replace(ENCODED_TOKEN, (_match, inner: string) => `{{${decodeURIComponent(inner)}}}`)
}
