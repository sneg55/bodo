// The member picker's rules, with no React in them.
//
// What the picker edits is a list of EMAIL ADDRESSES, because that is what the columns it
// feeds actually store: `Forms.adminAlertOnNew` and `Forms.adminAlertOnUpdate` hold
// addresses, not `AdminUsers` record ids. So the value in and the value out are
// `readonly string[]` of addresses, and the team list is only the source of SUGGESTIONS.
//
// That has one consequence worth stating, because it is the reason this file exists rather
// than a plain `Set` of ids in the component: an address in the column need not belong to
// anybody on the team. An organizer can legitimately alert `cfp@conference.example` or a
// colleague who has no admin account, and a stored value that names a member who has since
// been removed must not silently disappear from the control. So every stored address renders
// as a chip either way, and `recipientChips` labels which kind it is so the UI can show the
// difference instead of implying that a free-typed address is a team member.
//
// Comparison is on the normalized address throughout (`normalizeEmail`), because
// `Sam@Example.com` and `sam@example.com` are one mailbox and two chips would send two
// copies of the same alert.

import { isEmailLike, normalizeEmail, type TeamMember } from '@/features/team/members'

/** One suggestion in the popover: an address, and a name to show above it. */
export type RecipientOption = {
  readonly email: string
  readonly name: string
}

/** One chip. `kind` is what the UI renders differently, and it is the whole point. */
export type RecipientChip = {
  /** Normalized, so it matches what `onChange` would emit. */
  readonly email: string
  /** The member's name when there is one, the address otherwise. */
  readonly label: string
  /** `external` means "not on the event team", which is legal and shown as such. */
  readonly kind: 'member' | 'external'
}

export type RecipientAdd =
  | { readonly ok: true; readonly value: readonly string[] }
  | { readonly ok: false; readonly message: string }

/**
 * The team as picker options: real addresses only, de-duplicated, in the order given.
 *
 * A member whose `AdminUsers` row has been deleted has a blank email (`teamRows` keeps the
 * row so it can be revoked), and a blank address is not something you can send an alert to,
 * so it is dropped HERE rather than in `teamRows`. Two consumers, two correct answers.
 */
export function recipientOptions(members: readonly TeamMember[]): readonly RecipientOption[] {
  const seen = new Set<string>()
  const options: RecipientOption[] = []

  for (const member of members) {
    const email = normalizeEmail(member.email)
    if (email === '' || seen.has(email)) continue
    seen.add(email)
    options.push({ email, name: member.name.trim() })
  }
  return options
}

/**
 * A stored value as chips.
 *
 * Normalizes and de-duplicates, because the column is free text that a previous version of
 * this control, a seed script, or a hand edit in Airtable could all have written: two chips
 * for one mailbox would be two copies of the same alert.
 */
export function recipientChips(
  value: readonly string[],
  options: readonly RecipientOption[],
): readonly RecipientChip[] {
  const byEmail = new Map(options.map((option) => [option.email, option]))
  const seen = new Set<string>()
  const chips: RecipientChip[] = []

  for (const raw of value) {
    const email = normalizeEmail(raw)
    if (email === '' || seen.has(email)) continue
    seen.add(email)

    const option = byEmail.get(email)
    chips.push(
      option === undefined
        ? { email, label: email, kind: 'external' }
        : { email, label: option.name === '' ? email : option.name, kind: 'member' },
    )
  }
  return chips
}

/** Every stored address in normalized, de-duplicated form. What `onChange` emits. */
export function normalizeRecipients(value: readonly string[]): readonly string[] {
  return recipientChips(value, []).map((chip) => chip.email)
}

/**
 * Selecting a member in the popover: add it if absent, drop it if present.
 *
 * A toggle rather than an add, because the popover list is also where a selected member is
 * unselected. Removing by clicking the chip's × goes through `removeRecipient`.
 */
export function toggleRecipient(value: readonly string[], email: string): readonly string[] {
  const target = normalizeEmail(email)
  const current = normalizeRecipients(value)
  return current.includes(target)
    ? current.filter((entry) => entry !== target)
    : [...current, target]
}

export function removeRecipient(value: readonly string[], email: string): readonly string[] {
  const target = normalizeEmail(email)
  return normalizeRecipients(value).filter((entry) => entry !== target)
}

/**
 * A free-typed address, which the column can legitimately hold.
 *
 * A bad address is a REFUSAL with a message rather than a silent no-op: the organizer typed
 * something and pressed enter, and an alert recipient that was quietly dropped is discovered
 * when the alert does not arrive. An address already in the list is an ordinary success with
 * the list unchanged, because the intent ("this address should be a recipient") already
 * holds and an error there would be pedantry.
 */
export function addTypedRecipient(value: readonly string[], raw: string): RecipientAdd {
  const email = normalizeEmail(raw)
  if (email === '') return { ok: false, message: 'Email address is required.' }
  if (!isEmailLike(email)) {
    return { ok: false, message: `"${raw.trim()}" is not an email address.` }
  }

  const current = normalizeRecipients(value)
  return { ok: true, value: current.includes(email) ? current : [...current, email] }
}
