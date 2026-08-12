'use server'

// The ask half of ⌘K. One model call, no writes, and nothing rendered that this file did
// not resolve against the event's own rows.
//
// **Separate from `actions.ts` on purpose.** That action runs on every debounced
// keystroke and must stay cheap. This one runs when the organizer explicitly picks
// `Ask "..."`, costs a model call, and can take a second or two. Two actions in one file
// would invite the two budgets to be reasoned about as one.
//
// **`reviewer`, and authorized before anything is read**, matching `globalSearchAction`
// exactly: the answer is built out of the same submissions and speakers that action
// returns, so anyone who may search may ask. Doing it first also means a caller probing
// another event's id cannot use response timing to learn whether it has data, and it
// means a stranger's question never reaches the model.
//
// **The rows are narrowed to what the snapshot carried before any ref is resolved.** On
// an event larger than `SNAPSHOT_LIMIT` the rows read here and the rows the model saw are
// different lists, and resolving against the wider one would let an id past the cap
// resolve by luck. See the header of `src/features/ai/ask.ts`.
//
// **Nothing writes, so nothing is invalidated.** No `invalidate()` call belongs here.

import { AppError, ErrorIds } from '@/constants/errorIds'
import {
  ASK_MAX_TOKENS,
  ASK_SCHEMA,
  ASK_SYSTEM_PROMPT,
  type AskAnswer,
  type AskOutcome,
  askLengthProblem,
  readAskAnswer,
  resolveRefs,
  snapshotRows,
} from '@/features/ai/ask'
import { mockAskAnswer } from '@/features/ai/ask-mock'
import { loadEventSnapshot } from '@/features/ai/reads'
import { requireEventRole } from '@/features/auth/wiring'
import { type ActionResult, actionFailure, actionOk } from '@/features/review/action-result'
import { AI_SAMPLE_NOTICE, getAiClient, isAiMocked } from '@/services/ai'
import { listSpeakers, listSubmissions } from '@/services/airtable/queries'

export async function askEventAction(input: {
  eventId: string
  question: string
}): Promise<ActionResult<AskOutcome>> {
  try {
    // Before the reads and before the model call, for the reasons in the header.
    await requireEventRole(input.eventId, 'reviewer')

    // The palette offers the row only above the minimum and stops the field at the maximum,
    // but an action is an entry point of its own and a model call is the most expensive
    // thing in this file. Both ends matter: a question of arbitrary size is appended to the
    // snapshot and paid for before it comes back as `LLM_CONTEXT_OVERFLOW`.
    // `SUB_VALIDATION_FAIL` is the registry's general input-validation id despite its
    // prefix; the agenda, tasks and file-request actions already use it that way.
    const question = input.question.trim()
    const problem = askLengthProblem(question)
    if (problem !== undefined) {
      throw new AppError(ErrorIds.SUB_VALIDATION_FAIL, problem)
    }

    // The three reads are the same tagged `fetch` calls `loadEventSnapshot` makes, so the
    // two lists are served from the request's own cache rather than fetched twice. They
    // are read again here because the snapshot is text and ids: turning a cited id back
    // into a row needs the row.
    const [snapshot, submissions, speakers] = await Promise.all([
      loadEventSnapshot(input.eventId),
      listSubmissions(input.eventId),
      listSpeakers(input.eventId),
    ])
    const rows = snapshotRows({ ids: snapshot.ids, submissions, speakers })

    const raw = await getAiClient().complete<AskAnswer>({
      system: ASK_SYSTEM_PROMPT,
      context: snapshot.text,
      question,
      schema: ASK_SCHEMA,
      maxTokens: ASK_MAX_TOKENS,
      // The palette is interactive and the answer is three sentences over a digest that
      // is already laid out for counting. Latency is the scarce thing here, not depth.
      effort: 'low',
      mock: () => mockAskAnswer({ question, ...rows }),
    })

    // Re-checked rather than trusted: `parseAiMessage` proves the reply is an object and
    // stops there, and the mock is ordinary code that could regress the same way.
    const answer = readAskAnswer(raw)
    if (answer.answer === '') {
      throw new AppError(ErrorIds.LLM_BAD_RESPONSE, 'the model returned no answer text')
    }

    return actionOk({
      answer: answer.answer,
      items: resolveRefs(answer.refs, { eventId: input.eventId, ...rows }),
      mocked: isAiMocked(),
      // The wording travels with the flag. A client component importing the constant
      // reaches `@/services/ai`, which re-exports `liveClient`, which puts the Anthropic
      // SDK in the browser bundle of every admin page. See `AskOutcome.mockNotice`.
      mockNotice: isAiMocked() ? AI_SAMPLE_NOTICE : '',
      // Passed through so the palette can say the answer covers part of the event. A
      // partial answer shown as a whole one is the failure the snapshot's cap reporting
      // exists to prevent, and it only pays off if the last surface repeats it.
      truncated: snapshot.truncated,
    })
  } catch (error) {
    return actionFailure(error)
  }
}
