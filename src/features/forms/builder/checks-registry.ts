// The checks that protect a TYPED COLUMN, split out of checks.ts for the line limit.
//
// A field's `registryKey` is the only thing that routes its answer into a first-class
// Airtable column, and for `track` and `tags` those columns are LINKS: the option values
// are record ids, and `prepareSubmission` writes them straight through. So three things
// have to hold and none of them did:
//
//   - A `track` or `tags` option value must be a record on THIS event. `checkRouting`
//     validated routing-rule and fallback ids but not the option list itself, so a draft
//     could offer another event's track and a submission would be linked to it. Found by
//     Codex review, which reproduced exactly that.
//   - A `registryKey` must actually name a registry field. The editor only ever sets one
//     from the registry, but `saveFormAction` takes the whole draft from the client, so the
//     UI's good behaviour is not a check on a POST.
//   - Two fields must not claim the same key, or two answers race for one column and which
//     one lands is whichever `answer-storage` visits last.
//
// Two more were added after the CFP-01 evaluation finding, and both are about an option list
// the organizer could author but the column could never hold:
//
//   - A `format`, `level` or `language` option must be in the vocabulary its single-select
//     column was declared from (option-sources.ts says why that column cannot grow one).
//   - A `track` or `tags` question with NO options is no longer refused outright. It was, by
//     the generic "choice question with no options" rule in checks.ts, which made a form
//     created on an event with no categories unsaveable from birth. See `checkCategoryOptions`.
//
// Those last two were warnings, and a warning refuses nothing: the organizer could publish
// straight past both, and then every answer to those options was dropped silently. That is
// the CFP-15 twin, so the two that mean "an answer to this would be lost" now carry
// `blocksPublish` (problem.ts) and refuse the publish while still allowing the save.

import { ALL_REGISTRY_FIELDS, registryField } from '@/constants/fields'
import { COLUMN_BY_REGISTRY_KEY } from '@/features/forms/answer-storage'
import { unstorableVocabularyValues, vocabularyFor } from '@/features/forms/builder/option-sources'
import type { BuilderProblem } from '@/features/forms/builder/problem'
import type { FormField } from '@/types/forms'

/** `undefined` when this form writes no link columns, so option values are inert text. */
export type LinkOptions = { trackIds: readonly string[]; tagIds?: readonly string[] }

/** Where an organizer creates the categories a Track or Tags question offers. */
const LIBRARY = 'Event Settings > Tags'

export function checkRegistryKeys(
  fields: readonly FormField[],
  linkOptions: LinkOptions | undefined,
  step: number,
): readonly BuilderProblem[] {
  const problems: BuilderProblem[] = []
  const at = (message: string, severity: BuilderProblem['severity'] = 'error') => {
    problems.push({ severity, step, message })
  }
  const seen = new Set<string>()

  for (const field of fields) {
    const key = field.registryKey
    if (key === undefined) continue

    if (registryField(key) === undefined) {
      at(`"${field.label}" is bound to an unknown field key.`)
      continue
    }
    if (seen.has(key)) {
      at(`Two questions are bound to the same field, so one of their answers would be lost.`)
    }
    seen.add(key)

    if (linkOptions === undefined) continue
    problems.push(...checkCategoryOptions(field, key, linkOptions, step))
    problems.push(...checkVocabularyOptions(field, key, step))
  }

  problems.push(...checkImpostorFields(fields, seen, step))
  return problems
}

/**
 * A question that LOOKS like a library field but is not bound to one.
 *
 * Added after the 2026-08-12 evaluation run, which filed the same complaint twice under
 * CFP-15: a speaker answered `Platform & Infra` to a question headed "Track", and the
 * submission, the Abstracts list, the session and the agenda all read `Agents`. Nothing was
 * broken. The form's Track question had been built through the bare type picker rather than
 * the library, so it carried no `registryKey`, its answer went to `answersJson` as designed,
 * and the track column was left to a routing rule that maps `format eq talk -> Agents`.
 * Every other form in that base was built from the library and behaved correctly.
 *
 * So the gap is that a form can be built this way in silence. The organizer sees a Track
 * question with the event's real track names in it and has no way to know the answer will
 * not become the session's track. This is the one place that can tell them.
 *
 * A WARNING, not an error, and it does not block a publish. A custom question legitimately
 * called "Track" is a thing an organizer may want, `answersJson` holds its answer safely,
 * and nothing is lost - it simply is not authoritative. That is different in kind from the
 * two checks above that carry `blocksPublish`, where an answer would be dropped outright.
 *
 * Matched on the LABEL, which is exactly the inference `answer-storage` refuses to make when
 * placing an answer, and the difference matters: there, a wrong guess silently writes into a
 * column nothing is watching. Here the worst case is a sentence an organizer disagrees with
 * and ignores. Advice may guess; storage may not.
 *
 * Skipped for a key already claimed by a properly bound field, since a form may reasonably
 * carry both the library's Track and a second question that happens to share the word.
 */
function checkImpostorFields(
  fields: readonly FormField[],
  bound: ReadonlySet<string>,
  step: number,
): readonly BuilderProblem[] {
  const byLabel = new Map(
    ALL_REGISTRY_FIELDS.filter((entry) => COLUMN_BY_REGISTRY_KEY.has(entry.key)).map((entry) => [
      entry.label.toLowerCase(),
      entry,
    ]),
  )

  return fields.flatMap((field) => {
    if (field.registryKey !== undefined) return []
    const match = byLabel.get(field.label.trim().toLowerCase())
    if (match === undefined || bound.has(match.key)) return []
    return [
      {
        severity: 'warning' as const,
        step,
        message:
          `"${field.label}" is a custom question, not the ${match.label} field from the library, ` +
          `so its answers are stored with the form and do not set the submission's ${match.label}. ` +
          `Delete it and add ${match.label} from "+ Add Field" if you meant the library one.`,
      },
    ]
  })
}

/**
 * A Track or Tags question, against the event's own records.
 *
 * The empty case is a WARNING rather than an error, and that is the CFP-01 fix. A form
 * created on an event with no categories seeds both questions with no options, and the
 * generic "choice question with no options" error made that form unsaveable from the moment
 * it was created, over a list the builder cannot author and the organizer had not been told
 * where to find. It stays an error while the question is REQUIRED, because then the public
 * form really is unsubmittable.
 */
function checkCategoryOptions(
  field: FormField,
  key: string,
  linkOptions: LinkOptions,
  step: number,
): readonly BuilderProblem[] {
  const allowed = allowedCategoryIds(key, linkOptions)
  if (allowed === undefined) return []
  const at = (
    message: string,
    severity: BuilderProblem['severity'],
    blocksPublish = false,
  ): BuilderProblem => ({
    severity,
    step,
    message,
    fieldId: field.id,
    ...(blocksPublish ? { blocksPublish: true } : {}),
  })

  const options = field.options ?? []
  if (options.length === 0) {
    if (allowed.length > 0)
      return [
        at(
          // The warning is CORRECT, which is worth stating because the CFP-02 evaluation
          // asked whether it was: a `multiselect` with no options renders in
          // `FieldControl` as a labelled control with an empty list, so the speaker is
          // shown a question they cannot answer. What was wrong is that it named a
          // condition and no remedy, unlike the two messages around it. The remedy is the
          // same one `ConstrainedOptionsEditor` offers, and the surface it is fixed on is
          // now the step this problem is stamped with (`StepProblems` renders it there).
          `"${field.label}" offers none of this event's categories, so nobody can answer it. Open the question and pick the ones this form should offer, or delete the question.`,
          field.required ? 'error' : 'warning',
          // The event HAS categories and this question offers none of them, so a speaker is
          // shown a control with an empty list and the column behind it stays empty however
          // they answer. Saveable, because a half-built draft is allowed; not publishable,
          // because past this point it is a stranger losing the answer rather than the
          // organizer losing their place. This is the case CFP-15 hit: the Track question
          // was on the form, the speaker had no way to answer it, and the routing rule
          // filed every talk under a track nobody chose.
          true,
        ),
      ]
    return [
      at(
        `"${field.label}" has no categories to offer yet. Add them in ${LIBRARY}, then choose them in this question.`,
        field.required ? 'error' : 'warning',
        // Deliberately NOT publish-blocking. The event has no categories at all, so there
        // is nothing the organizer can pick in this question and the remedy is on another
        // screen entirely. Refusing the publish here would hold a whole call for papers
        // hostage to a Library the organizer may never intend to fill, which is the shape
        // of the CFP-01 finding one gate further along.
      ),
    ]
  }

  const foreign = options.filter((option) => !allowed.includes(option.value))
  if (foreign.length === 0) return []
  return [
    at(
      // Named rather than counted, so the message says which option to fix, and worded like
      // the vocabulary one below because they are the same defect on different columns: an
      // option the column cannot store. It was `"Track" offers categories that do not
      // belong to this event`, which told an organizer looking at a list of plausible track
      // names nothing about which one was wrong.
      `"${field.label}" offers ${foreign.map((option) => `"${option.label}"`).join(', ')}, which ${foreign.length === 1 ? 'is not a category' : 'are not categories'} on this event, so an answer of ${foreign.length === 1 ? 'it' : 'them'} would be dropped. Open the question and pick from this event's categories.`,
      'error',
    ),
  ]
}

/**
 * A Format, Level or Language question, against the vocabulary its column was declared from.
 *
 * A warning rather than an error, deliberately: the value is stored by `canonicalChoice`,
 * which drops an unmatched answer instead of 422-ing the whole submission, so the form still
 * works. What is lost is that one answer, silently, weeks after the option was typed. A form
 * that already carries such an option must stay saveable while the organizer fixes it, which
 * is the same mistake the category check used to make.
 */
function checkVocabularyOptions(
  field: FormField,
  key: string,
  step: number,
): readonly BuilderProblem[] {
  const vocabulary = vocabularyFor(key)
  if (vocabulary === undefined) return []
  const unstorable = unstorableVocabularyValues(field, vocabulary)
  if (unstorable.length === 0) return []

  return [
    {
      severity: 'warning',
      step,
      fieldId: field.id,
      // Still a warning, so a form already carrying such an option stays saveable while the
      // organizer fixes it, and still publish-blocking, because the whole content of the
      // warning is that an answer would be dropped and a published form is where answers
      // come from. The CFP-01 evaluation found three offered Formats in exactly this state
      // on a live, published form.
      blocksPublish: true,
      message: `"${field.label}" offers ${unstorable.map((value) => `"${value}"`).join(', ')}, which the ${field.label} column cannot store, so an answer of it would be dropped. Open the question and pick from the listed choices.`,
    },
  ]
}

function allowedCategoryIds(key: string, linkOptions: LinkOptions): readonly string[] | undefined {
  if (key === 'track') return linkOptions.trackIds
  if (key === 'tags') return linkOptions.tagIds
  return undefined
}
