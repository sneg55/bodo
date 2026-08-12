// `Group files by`: the control that "reorganize[s] how files will appear in folders".
//
// The reference (docs/parity/external-references.md, "Bulk file download") confirms the
// control, its label and what it does, and does NOT enumerate its options. So the four
// below are AUTHORED, and they are the four the data can actually express: a file row
// carries a submission, a speaker and a kind, and nothing else worth foldering by. `none`
// exists because a flat archive is what somebody re-uploading the lot to a CMS wants.
//
// Everything here is pure, including the name collision rule, which is the part that
// silently corrupts an archive if it is wrong: two members with the same path make a zip
// that extracts one over the other.

/** The option values, in the order the Select renders them. `session` is the default. */
export const BUNDLE_GROUPINGS = ['session', 'speaker', 'type', 'none'] as const

export type BundleGrouping = (typeof BUNDLE_GROUPINGS)[number]

export const BUNDLE_GROUPING_OPTIONS: readonly {
  readonly value: BundleGrouping
  readonly label: string
}[] = [
  { value: 'session', label: 'Session' },
  { value: 'speaker', label: 'Speaker' },
  { value: 'type', label: 'File type' },
  { value: 'none', label: 'No folders' },
]

export const DEFAULT_BUNDLE_GROUPING: BundleGrouping = 'session'

/** Anything unrecognised falls back to the default rather than throwing: it is a view knob. */
export function parseGrouping(value: string | null | undefined): BundleGrouping {
  return BUNDLE_GROUPINGS.find((option) => option === value) ?? DEFAULT_BUNDLE_GROUPING
}

/** Folder names for `type`, which are labels rather than the raw `Files.kind` values. */
const TYPE_FOLDERS = new Map<string, string>([
  ['headshot', 'Headshots'],
  ['slides', 'Slides'],
  ['doc', 'Documents'],
])

const UNGROUPED = 'Other'

/** What grouping needs to know about one file. A projection of ./reads' candidate. */
export type PlaceableFile = {
  readonly id: string
  readonly filename: string
  readonly kind: string
  /** "SESS-12 Scaling Postgres". Blank when the file hangs off no session. */
  readonly sessionLabel: string
  readonly speakerLabel: string
}

export type BundleEntry = { readonly id: string; readonly path: string }

function folderFor(file: PlaceableFile, grouping: BundleGrouping): string {
  switch (grouping) {
    case 'session':
      return segment(file.sessionLabel, 'Unassigned')
    case 'speaker':
      return segment(file.speakerLabel, 'Unknown speaker')
    case 'type':
      return TYPE_FOLDERS.get(file.kind) ?? UNGROUPED
    case 'none':
      return ''
  }
}

/**
 * One path segment, safe to write into a zip.
 *
 * Separators go rather than being escaped, because a name that arrived from a form field is
 * the one place a `../` could reach out of the archive on extraction. Control characters go
 * for the same reason. A trailing dot is trimmed because Windows cannot create the
 * directory, and the length cap keeps a long session title from blowing the path limit.
 */
function segment(raw: string, fallback: string): string {
  const cleaned = stripControlCharacters(raw)
    .replace(/[/\\:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    // Leading dots and dashes go, which is what turns `../../etc/passwd` into `etc-passwd`
    // rather than leaving a name that reads like a traversal even though it can no longer be
    // one. `sanitizeFilename` in services/storage/upload-limits already does this to object
    // keys, so a stored file and its archive member are cleaned the same way.
    .replace(/^[.\-\s]+/, '')
    .replace(/[.\s]+$/, '')
    .slice(0, 80)
    .trim()
  return cleaned === '' ? fallback : cleaned
}

/**
 * Control characters out, as spaces.
 *
 * Filtered by code point rather than by a regex class, because a control-character class is
 * what `no-control-regex` exists to flag and an inline disable for it would be one more
 * thing to justify than a loop.
 */
function stripControlCharacters(raw: string): string {
  return [...raw]
    .map((character) => {
      const code = character.codePointAt(0) ?? 0
      return code < 0x20 || code === 0x7f ? ' ' : character
    })
    .join('')
}

/** `deck.pdf` becomes `deck (2).pdf`: the suffix goes before the extension, not after it. */
function withCopyIndex(filename: string, index: number): string {
  const dot = filename.lastIndexOf('.')
  const suffix = ` (${String(index)})`
  if (dot <= 0) return `${filename}${suffix}`
  return `${filename.slice(0, dot)}${suffix}${filename.slice(dot)}`
}

/**
 * The archive path for every file, folders applied and collisions resolved.
 *
 * Collisions are resolved PER FOLDER and only within one archive, which is what makes the
 * result depend on the grouping: two speakers' `headshot.png` collide under `type` and do
 * not under `speaker`. The counter is seeded from the taken set rather than from a per-name
 * tally, so `a.pdf`, `a.pdf`, `a (2).pdf` cannot resolve two members onto `a (2).pdf`.
 */
export function bundleEntryPaths(
  files: readonly PlaceableFile[],
  grouping: BundleGrouping,
): readonly BundleEntry[] {
  const taken = new Set<string>()

  return files.map((file) => {
    const folder = folderFor(file, grouping)
    const name = segment(file.filename, 'file')
    let candidate = folder === '' ? name : `${folder}/${name}`

    for (let index = 2; taken.has(candidate.toLowerCase()); index += 1) {
      const indexed = withCopyIndex(name, index)
      candidate = folder === '' ? indexed : `${folder}/${indexed}`
    }
    taken.add(candidate.toLowerCase())

    return { id: file.id, path: candidate }
  })
}
