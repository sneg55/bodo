// The open-ended single-select vocabularies, in one place, because two copies of
// one of these lists is a 422 waiting to happen.
//
// Unlike `status.ts`, none of these is a lifecycle the app reasons about: the DAL
// reads every one of them through `optionalText`, so nothing branches on the value.
// They exist only because Airtable needs a choice list to create the column with,
// and that is exactly what makes them dangerous. Airtable will not accept a write of
// a single-select value that is not already a declared choice, and this project's
// token cannot create choices:
//
//     422 INVALID_MULTIPLE_CHOICE_OPTIONS
//     Insufficient permissions to create new select option "Woman"
//
// It is also case sensitive. The portal offered `Woman` / `Non-binary` while the
// migration declared `woman` / `non-binary`, so picking any gender rejected the whole
// speaker record, taking the bio, the headshot and every social link down with it.
// Matching by eye across two files did not work and would not have kept working, so
// the value and the label are declared together here, once:
//
//   - `value` is what Airtable stores, and it is what the migration declares as the
//     column's choices. Changing one is a schema change (see below).
//   - `label` is what a person reads. Change it freely.
//
// **Changing a `value` does not migrate a base that already exists.** `planSchema` in
// src/migrations/diff.ts never alters a field that is already there, by design, so an
// existing base keeps its original choices and writes of the new value will 422. Add
// the choice in the Airtable UI first, or accept the base's spelling here.

export type Choice = { readonly value: string; readonly label: string }

/** Just the stored values, which is the shape `select()` in the migration wants. */
export function choiceValues(choices: readonly Choice[]): readonly string[] {
  return choices.map((choice) => choice.value)
}

export function isChoice(choices: readonly Choice[], value: string): boolean {
  return choices.some((choice) => choice.value === value)
}

export const SESSION_FORMATS: readonly Choice[] = [
  { value: 'talk', label: 'Talk' },
  { value: 'workshop', label: 'Workshop' },
  { value: 'panel', label: 'Panel' },
  { value: 'keynote', label: 'Keynote' },
  { value: 'lightning', label: 'Lightning Talk' },
]

export const SESSION_LEVELS: readonly Choice[] = [
  { value: 'beginner', label: 'Beginner' },
  { value: 'intermediate', label: 'Intermediate' },
  { value: 'advanced', label: 'Advanced' },
]

export const SESSION_LANGUAGES: readonly Choice[] = [
  { value: 'English', label: 'English' },
  { value: 'Spanish', label: 'Spanish' },
  { value: 'French', label: 'French' },
  { value: 'German', label: 'German' },
  { value: 'Japanese', label: 'Japanese' },
  { value: 'Portuguese', label: 'Portuguese' },
]

/**
 * Lowercase values because that is what the migration declared and what every base
 * built from it already holds. The labels carry the capitalisation a person expects.
 */
export const PRONOUNS: readonly Choice[] = [
  { value: 'she/her', label: 'she/her' },
  { value: 'he/him', label: 'he/him' },
  { value: 'they/them', label: 'they/them' },
  { value: 'she/they', label: 'she/they' },
  { value: 'he/they', label: 'he/they' },
  { value: 'prefer not to say', label: 'Prefer not to say' },
]

export const GENDERS: readonly Choice[] = [
  { value: 'woman', label: 'Woman' },
  { value: 'man', label: 'Man' },
  { value: 'non-binary', label: 'Non-binary' },
  { value: 'prefer not to say', label: 'Prefer not to say' },
  { value: 'self-describe', label: 'Self-describe' },
]

export const EVENT_TYPES: readonly Choice[] = [
  { value: 'Conference', label: 'Conference' },
  { value: 'Summit', label: 'Summit' },
  { value: 'Workshop', label: 'Workshop' },
  { value: 'Webinar', label: 'Webinar' },
  { value: 'Meetup', label: 'Meetup' },
  { value: 'Hackathon', label: 'Hackathon' },
]
