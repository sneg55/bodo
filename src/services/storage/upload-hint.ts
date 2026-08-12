// What an upload control should TELL somebody, derived from the rules already enforced.
//
// Separate from `upload-limits.ts` because these are two different jobs and only one of
// them is a security boundary: that file DECIDES what may be uploaded and is called on
// every request before a byte is written; this one turns the same numbers into a sentence
// and an `accept` attribute. Keeping them apart also keeps the enforcing module under the
// size limit, which is how it came to be split in the first place.
//
// The limits have been checked since uploads shipped and stated nowhere a speaker could
// read them, so the only way to discover that a 40 MB deck is too large was to upload it
// and be refused. A constraint nobody can see is one they find out about the slowest
// possible way.

import { type UploadKind, uploadLimit } from '@/services/storage/upload-limits'

/**
 * MIME type to the extension a person recognises.
 *
 * Derived from the same `types` list the server enforces rather than written beside it.
 * Two lists drift, and always in the same direction: the picker keeps offering something
 * the upload has quietly stopped accepting, so the refusal arrives after the file has been
 * chosen rather than before. A type with no entry here is simply not advertised, which
 * narrows the picker without ever widening what is accepted.
 */
const EXTENSIONS: ReadonlyMap<string, string> = new Map([
  ['image/jpeg', '.jpg'],
  ['image/png', '.png'],
  ['image/webp', '.webp'],
  ['application/pdf', '.pdf'],
  ['application/msword', '.doc'],
  ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.docx'],
  ['application/vnd.ms-powerpoint', '.ppt'],
  ['application/vnd.openxmlformats-officedocument.presentationml.presentation', '.pptx'],
  ['application/x-iwork-keynote-sffkey', '.key'],
])

export type UploadHint = {
  /** For the picker's `accept`, so the OS dialog filters before anything is chosen. */
  readonly accept: string
  /** One sentence for a person, e.g. "PDF, PPT, PPTX or KEY, up to 25 MB". */
  readonly text: string
}

/**
 * Takes several kinds because some controls accept more than one.
 *
 * A file request is the case: `uploadKindFor` decides between `slides` and `doc` from the
 * chosen file's type, which happens after the point where the control has to say what it
 * takes. Asking for both is the honest answer there.
 */

export function uploadHint(...kinds: readonly UploadKind[]): UploadHint {
  const limits = kinds.map(uploadLimit)
  const extensions = [...new Set(limits.flatMap((limit) => extensionsOf(limit.types)))]

  // GROUPED BY CAP, so the sentence stays true of every file the control takes.
  //
  // It used to state the smallest cap across the kinds, on the grounds that the tighter
  // limit is the only number true of everything. That is safe and it is also wrong the
  // moment two kinds differ: a control taking images at 10 MB and decks at 25 MB was
  // telling a speaker their 20 MB deck was too large. Saying both is the honest answer,
  // and a control asking about one kind still renders exactly one clause.
  const byCap = new Map<number, string[]>()
  for (const limit of limits) {
    const group = byCap.get(limit.maxBytes) ?? []
    for (const extension of extensionsOf(limit.types)) {
      if (!group.includes(extension)) group.push(extension)
    }
    byCap.set(limit.maxBytes, group)
  }

  const clauses = [...byCap.entries()]
    // Ascending, so the tightest constraint is read first.
    .sort(([left], [right]) => left - right)
    .map(([maxBytes, group]) => `${nameList(group)}, up to ${megabytes(maxBytes)}`)

  return { accept: extensions.join(','), text: clauses.join('; ') }
}

function extensionsOf(types: readonly string[]): readonly string[] {
  return types.flatMap((type) => {
    const extension = EXTENSIONS.get(type)
    return extension === undefined ? [] : [extension]
  })
}

function nameList(extensions: readonly string[]): string {
  const names = extensions.map((extension) => extension.slice(1).toUpperCase())
  const last = names.at(-1)
  if (last === undefined) return 'Any file'
  if (names.length === 1) return last
  return `${names.slice(0, -1).join(', ')} or ${last}`
}

function megabytes(bytes: number): string {
  return `${String(Math.round(bytes / (1024 * 1024)))} MB`
}
