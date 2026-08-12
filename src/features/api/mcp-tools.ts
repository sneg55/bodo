// The tools bodo's MCP server offers, and what each one runs.
//
// **All read-only, and that is a product decision rather than a limitation.** An agent that
// can accept a submission or email a speaker on its own is not something an organizer can
// safely point at a live conference the week of the event, and nobody asked for it. What they
// do want is the answer to "who still owes me a headshot" without opening a browser.
//
// Every tool wraps a function that already exists and is already used by a screen, so an
// answer here cannot drift from what the admin UI shows: the sessions come from the same
// published-agenda read as the public embeds, and `outstanding_tasks` is the same resolution
// the Tasks page and the nightly reminder both use.

import { AppError, type ErrorId, ErrorIds } from '@/constants/errorIds'
import type { EventRole } from '@/constants/status'
import { type ApiCaller, callerSatisfies } from '@/features/api/auth'
import { readApiEvent, readApiEvents, readApiSessions, readApiSpeakers } from '@/features/api/reads'
import { outstandingTaskRows } from '@/features/comms/outstanding-tasks'
import { acceptedSpeakerScopes } from '@/features/tasks/scope'
import { getEvent, listSubmissions, listTaskAssignmentsForEvent } from '@/services/airtable/queries'

export type McpTool = {
  readonly name: string
  readonly description: string
  readonly inputSchema: Record<string, unknown>
  readonly run: (args: Record<string, unknown>, caller: ApiCaller) => Promise<unknown>
}

/** Every tool takes an event slug except the one that lists the slugs. */
const eventSlugSchema = {
  type: 'object',
  properties: {
    event: { type: 'string', description: "The event's slug, from list_events." },
  },
  required: ['event'],
} as const

export const MCP_TOOLS: readonly McpTool[] = [
  {
    name: 'list_events',
    description:
      'Every event this token can see, with slug, dates and location. Call this first: the other tools take a slug.',
    inputSchema: { type: 'object', properties: {} },
    run: async (_args, caller) => await readApiEvents(caller.eventIds),
  },
  {
    name: 'list_sessions',
    description:
      'The published schedule for an event, in start order, with room, track and speakers resolved to names. Unpublished, rejected and cancelled sessions are not included.',
    inputSchema: eventSlugSchema,
    run: async (args, caller) => await readApiSessions(await eventIdFor(args, caller)),
  },
  {
    name: 'list_speakers',
    description:
      'Speakers appearing on the published schedule, with bio, company and headshot. Contact details are never returned.',
    inputSchema: eventSlugSchema,
    run: async (args, caller) => await readApiSpeakers(await eventIdFor(args, caller)),
  },
  {
    name: 'outstanding_tasks',
    // **This one DOES return speaker email addresses**, unlike `list_speakers` above, and the
    // difference is deliberate rather than an oversight. `list_speakers` answers "who is
    // speaking", which is a question a conference website asks and which does not need a way
    // to contact anybody. This answers "who do I chase", where the address IS the answer, and
    // it is the same roster the organizer already has open in the Tasks screen. Both are
    // behind the same organizer-scoped token; the narrowing on the public-facing one is
    // about what a leaked token would expose to a scraper, not about hiding it from the
    // organizer.
    //
    // **And it is the one tool that requires `admin` on the event.** "Behind an
    // organizer-scoped token" was doing more work in that paragraph than it could carry: a
    // token reaches every event its owner holds ANY membership on, and a `reviewer` is a
    // membership. A reviewer reads anonymised abstracts in the admin UI and has no route to
    // the roster, so handing them addresses and onboarding state through MCP would be a
    // capability the product does not otherwise grant them.
    description:
      'Which accepted speakers still have onboarding tasks to complete, what each one owes, and how to reach them. This is the same answer the organizer dashboard shows.',
    inputSchema: eventSlugSchema,
    run: async (args, caller) => await runOutstandingTasks(await eventIdFor(args, caller, 'admin')),
  },
]

/**
 * A slug to a record id, refusing anything this token cannot see, or cannot see AS `required`.
 *
 * The authorization is here rather than in the route, because the route dispatches every tool
 * through one path and cannot know which argument names an event. Throwing is correct: the
 * caller turns it into an `isError` tool result, which is what tells an agent to try something
 * else rather than that the server is broken.
 *
 * **A role refusal is worded and identified exactly like an unknown slug**, and deliberately
 * so. Answering "you are only a reviewer on ai-eng-2026" would confirm both that the slug is
 * real and what the caller's role on it is, which turns the tool into the probe that requiring
 * a role was meant to close.
 */
async function eventIdFor(
  args: Record<string, unknown>,
  caller: ApiCaller,
  required?: EventRole,
): Promise<string> {
  const slug = args.event
  if (typeof slug !== 'string' || slug.trim() === '') {
    throw toolFailure(
      ErrorIds.SUB_VALIDATION_FAIL,
      'event is required: pass the slug from list_events',
    )
  }
  const event = await readApiEvent(slug, caller.eventIds)
  if (
    event === undefined ||
    (required !== undefined && !callerSatisfies(caller, event.id, required))
  ) {
    // Not found and not-yours are one answer here for the same reason they are in the REST
    // routes: an agent that could tell them apart is an event-slug enumerator.
    throw toolFailure(ErrorIds.DATA_RECORD_NOT_FOUND, `no event with slug ${slug}`)
  }
  return event.id
}

/**
 * A failure whose MESSAGE was written here, and is therefore safe to hand back to an agent.
 *
 * The mark is what the route reads to decide whether to pass the text through or suppress it
 * (`src/app/api/v1/mcp/route.ts`). The alternative, an allowlist of error ids, does not work:
 * `DATA_RECORD_NOT_FOUND` is raised both by `eventIdFor` above, where the message is a slug the
 * caller just supplied, and by the Airtable client, where it names a table. One id, two very
 * different disclosures, so the marker is on the throw SITE rather than on the id.
 */
export function toolFailure(id: ErrorId, message: string): AppError {
  return new AppError(id, message, { toolFacing: true })
}

/** Whether this error's message came from a `toolFailure` above and may be returned as-is. */
export function isToolFacing(error: AppError): boolean {
  return error.context.toolFacing === true
}

/**
 * R6's answer, over MCP.
 *
 * The three reads are the ones the Tasks page already makes, so this subscribes to nothing new
 * and is warm whenever an organizer has that screen open. `acceptedSpeakerScopes` is what
 * limits it to people who are actually speaking: someone whose submission was rejected does
 * not owe a headshot.
 */
async function runOutstandingTasks(eventId: string): Promise<unknown> {
  const [event, items, submissions] = await Promise.all([
    getEvent(eventId),
    listTaskAssignmentsForEvent(eventId),
    listSubmissions(eventId),
  ])

  return outstandingTaskRows({
    scopes: acceptedSpeakerScopes(submissions),
    items,
    timeZone: event.timezone,
  })
}

/** The `tools/list` payload: everything above, without the implementations. */
export function toolDescriptors(): unknown {
  return {
    tools: MCP_TOOLS.map(({ name, description, inputSchema }) => ({
      name,
      description,
      inputSchema,
    })),
  }
}
