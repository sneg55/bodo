// The markdown half of a resource page, rendered as React elements.
//
// No `dangerouslySetInnerHTML` anywhere: ./markdown.ts turns the stored body into a
// closed set of blocks and spans, and this file is the only thing that turns those into
// elements. So the body can produce headings, paragraphs, lists, quotes, code and links,
// and it cannot produce anything else, whatever an organizer pastes in.
//
// Links leave the app, so they carry `rel="noreferrer"`. `target="_blank"` is NOT set:
// an in-page anchor and a relative portal link are both legitimate hrefs here, and
// opening those in a tab would be wrong.

import type { MdBlock, MdSpan } from './markdown'

export function MarkdownBody({ blocks }: { blocks: readonly MdBlock[] }) {
  return (
    <div className="space-y-4 text-sm leading-relaxed">
      {blocks.map((block, index) => (
        <Block key={index} block={block} />
      ))}
    </div>
  )
}

function Block({ block }: { block: MdBlock }) {
  switch (block.kind) {
    case 'heading':
      return <Heading block={block} />
    case 'paragraph':
      return (
        <p className="whitespace-pre-line">
          <Spans spans={block.spans} />
        </p>
      )
    case 'quote':
      return (
        <blockquote className="border-l-2 border-border pl-4 text-muted-foreground">
          <Spans spans={block.spans} />
        </blockquote>
      )
    case 'list':
      return <List block={block} />
    case 'code':
      return (
        <pre className="overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs">
          <code>{block.text}</code>
        </pre>
      )
    case 'rule':
      return <hr className="border-border" />
  }
}

/** Heading levels are `h2`-`h6`; the page's own title is the `h1`. */
function Heading({ block }: { block: Extract<MdBlock, { kind: 'heading' }> }) {
  const content = <Spans spans={block.spans} />
  const className = HEADING_CLASS[block.level]

  switch (block.level) {
    case 2:
      return <h2 className={className}>{content}</h2>
    case 3:
      return <h3 className={className}>{content}</h3>
    case 4:
      return <h4 className={className}>{content}</h4>
    case 5:
      return <h5 className={className}>{content}</h5>
    case 6:
      return <h6 className={className}>{content}</h6>
  }
}

const HEADING_CLASS = {
  2: 'font-heading text-lg font-medium',
  3: 'font-heading text-base font-medium',
  4: 'text-sm font-semibold',
  5: 'text-sm font-semibold',
  6: 'text-sm font-semibold',
} as const

function List({ block }: { block: Extract<MdBlock, { kind: 'list' }> }) {
  const items = block.items.map((spans, index) => (
    <li key={index}>
      <Spans spans={spans} />
    </li>
  ))

  return block.ordered ? (
    <ol className="list-decimal space-y-1 pl-5">{items}</ol>
  ) : (
    <ul className="list-disc space-y-1 pl-5">{items}</ul>
  )
}

function Spans({ spans }: { spans: readonly MdSpan[] }) {
  return (
    <>
      {spans.map((span, index) => (
        <Span key={index} span={span} />
      ))}
    </>
  )
}

function Span({ span }: { span: MdSpan }) {
  const marked = markedText(span)
  if (span.href === undefined) return marked

  return (
    <a
      href={span.href}
      rel="noreferrer"
      className="text-primary underline underline-offset-2 hover:no-underline"
    >
      {marked}
    </a>
  )
}

function markedText(span: MdSpan) {
  if (span.code === true) {
    return <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">{span.text}</code>
  }

  let content = <>{span.text}</>
  if (span.em === true) content = <em>{content}</em>
  if (span.strong === true) content = <strong className="font-semibold">{content}</strong>
  return content
}
