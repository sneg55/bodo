#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const [captionsPath, infoPath, outputDirectory] = process.argv.slice(2)

if (!captionsPath || !infoPath || !outputDirectory) {
  console.error(
    'Usage: node scripts/json3-to-transcript.mjs <captions.json3> <info.json> <output-directory>',
  )
  process.exit(1)
}

const [captions, info] = await Promise.all([
  readFile(captionsPath, 'utf8').then(JSON.parse),
  readFile(infoPath, 'utf8').then(JSON.parse),
])

function normalizeCaptionText(text) {
  return text
    .replace(/\bsession boards\b/gi, "Sessionboard's")
    .replace(/\bsession board\b/gi, 'Sessionboard')
    .replace(/\bsession eyes\b/gi, 'Sessionize')
    .replace(/\bGoogle doc\b/g, 'Google Doc')
    .replace(/\s+/g, ' ')
    .trim()
}

const cues = captions.events
  .filter((event) => event.segs && !event.aAppend)
  .map((event) => ({
    startMs: Number(event.tStartMs ?? 0),
    durationMs: Number(event.dDurationMs ?? 0),
    text: normalizeCaptionText(event.segs.map((segment) => segment.utf8 ?? '').join('')),
  }))
  .filter((cue) => cue.text.length > 0)
  .map((cue, index, allCues) => {
    const nextStartMs = allCues[index + 1]?.startMs
    const naturalEndMs = cue.startMs + cue.durationMs
    const endMs = nextStartMs ? Math.min(naturalEndMs, nextStartMs) : naturalEndMs

    return {
      ...cue,
      endMs: Math.max(cue.startMs + 500, endMs),
    }
  })

if (cues.length === 0) {
  throw new Error('No spoken caption cues were found in the JSON3 input.')
}

function srtTimestamp(milliseconds) {
  const hours = Math.floor(milliseconds / 3_600_000)
  const minutes = Math.floor((milliseconds % 3_600_000) / 60_000)
  const seconds = Math.floor((milliseconds % 60_000) / 1_000)
  const millis = Math.floor(milliseconds % 1_000)

  return (
    [hours, minutes, seconds].map((part) => String(part).padStart(2, '0')).join(':') +
    `,${String(millis).padStart(3, '0')}`
  )
}

function readableTimestamp(milliseconds) {
  const totalSeconds = Math.floor(milliseconds / 1_000)
  const hours = Math.floor(totalSeconds / 3_600)
  const minutes = Math.floor((totalSeconds % 3_600) / 60)
  const seconds = totalSeconds % 60
  const parts = hours > 0 ? [hours, minutes, seconds] : [minutes, seconds]

  return parts
    .map((part, index) => (index === 0 ? String(part) : String(part).padStart(2, '0')))
    .join(':')
}

function escapeMarkdown(text) {
  return text.replace(/([\\`*_{}\[\]<>])/g, '\\$1')
}

function buildParagraphs(allCues) {
  const paragraphs = []
  let current = null

  for (const cue of allCues) {
    current ??= { startMs: cue.startMs, endMs: cue.endMs, text: '' }
    current.text = `${current.text} ${cue.text}`.trim()
    current.endMs = cue.endMs

    const elapsedMs = current.endMs - current.startMs
    const endsSentence = /[.!?][\"')\]]?$/.test(cue.text)

    if (elapsedMs >= 20_000 && endsSentence) {
      paragraphs.push({
        ...current,
        text: normalizeCaptionText(current.text),
      })
      current = null
    }
  }

  if (current) {
    paragraphs.push({
      ...current,
      text: normalizeCaptionText(current.text),
    })
  }

  return paragraphs
}

const paragraphs = buildParagraphs(cues)
const sourceUrl = info.webpage_url ?? info.original_url ?? ''
const title = info.title ?? path.basename(captionsPath)
const channel = info.channel ?? info.uploader ?? 'Unknown'
const duration = readableTimestamp(Number(info.duration ?? 0) * 1_000)
const note =
  "Generated from the video's English automatic captions. Spacing, paragraph breaks, and obvious product-name capitalization were normalized; recognition errors may remain."

const srt = cues
  .map(
    (cue, index) =>
      `${index + 1}\n${srtTimestamp(cue.startMs)} --> ${srtTimestamp(cue.endMs)}\n${cue.text}`,
  )
  .join('\n\n')

const transcriptText = paragraphs
  .map((paragraph) => `[${readableTimestamp(paragraph.startMs)}] ${paragraph.text}`)
  .join('\n\n')

const transcriptMarkdown = `# ${escapeMarkdown(title)}

- Speaker/channel: ${escapeMarkdown(channel)}
- Duration: ${duration}
- Source: ${sourceUrl}
- Note: ${note}

## Transcript

${paragraphs
  .map(
    (paragraph) =>
      `**[${readableTimestamp(paragraph.startMs)}]** ${escapeMarkdown(paragraph.text)}`,
  )
  .join('\n\n')}
`

await mkdir(outputDirectory, { recursive: true })
await Promise.all([
  writeFile(path.join(outputDirectory, 'transcript.srt'), `${srt}\n`),
  writeFile(path.join(outputDirectory, 'transcript.txt'), `${transcriptText}\n`),
  writeFile(path.join(outputDirectory, 'transcript.md'), transcriptMarkdown),
])

console.log(`Wrote ${cues.length} subtitle cues and ${paragraphs.length} transcript paragraphs.`)
