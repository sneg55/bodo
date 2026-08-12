// Size labels for the bundle, shared by the modal and the email.
//
// Its own module, small as it is, because the two consumers sit on opposite sides of the
// server boundary: `./email` renders markdown through `marked`, so a client component that
// imported the label from there would pull a markdown parser into the browser bundle for one
// string. Nothing here imports anything.

/**
 * Whole megabytes, or kilobytes below one.
 *
 * Rounded rather than precise on purpose: the number exists so somebody can tell a 4 MB
 * download from a 400 MB one before clicking, and a byte count says nothing they can act on.
 * Never rounds down to "0 KB", because a bundle that reports zero looks broken.
 */
export function bundleSizeLabel(totalBytes: number): string {
  const megabytes = totalBytes / (1024 * 1024)
  if (megabytes >= 1) return `${String(Math.round(megabytes))} MB`
  return `${String(Math.max(1, Math.round(totalBytes / 1024)))} KB`
}

/** "1 file" / "12 files", so nothing reads like a form letter with a bad plural. */
export function countLabel(value: number, noun: string): string {
  return `${String(value)} ${noun}${value === 1 ? '' : 's'}`
}
