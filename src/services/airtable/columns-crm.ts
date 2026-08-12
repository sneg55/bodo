// The SpeakerTags and SpeakerLists half of the column registry (R11).
//
// Split out of tables.ts on the same seam, and for the same reason, as columns-cms.ts:
// that file was already at its size budget when the CRM landed, and these columns belong
// to two tables no other mapper touches. Every rule from tables.ts still applies, because
// `COL` is one object built by spreading this into it: one name for one concept, and
// Airtable's own spelling appears nowhere outside this directory.
//
// `name`, `colour` and `eventId` are deliberately absent: they are already in `COL` and a
// second spelling of a shared concept is what the one-registry rule exists to prevent.

export const COL_CRM = {
  /**
   * A speaker list's saved FILTER, not its members.
   *
   * The whole difference between a list and a static group: re-opening a list re-runs the
   * definition, so a speaker who has since matched appears and one who no longer does is
   * gone. Storing members instead would make every list a snapshot that silently rots, and
   * there would be nowhere to put the question the organizer actually saved.
   */
  definitionJson: 'definitionJson',
  /** Whether other organizers on the event can see the list, or only its owner. */
  isShared: 'isShared',
  /** SpeakerTags -> Speakers. Plural, because a tag is a label on many people. */
  speakers: 'speakers',
} as const
