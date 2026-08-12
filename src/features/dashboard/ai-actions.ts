'use server'

// The `AI prompt` tab's two writes-in-waiting: propose a dashboard, then create the proposal.
//
// A separate file from ./actions.ts rather than two more functions in it, because these two are
// the only dashboard actions that reach the model boundary and the only ones that are a
// two-step: everything in ./actions.ts commits on the click that calls it.
//
// **Proposing does not create.** That is the decision recorded in the design doc, and it is what
// makes the enum validation worth anything: the organizer sees the name, the colour and the
// widget list, and can drop a widget, before a row exists. A tab that appeared on the first
// click would have to be deleted to be undone.
//
// **The proposal is validated on the way in AND on the way back.** `proposeDashboardAction`
// checks what the model answered; `createDashboardFromProposalAction` checks the object the
// browser posts, which is a different object that merely looks like the first one. A Server
// Action is reachable by POST with any body at all (BUILD_SPEC 4), so the typed parameter is a
// convenience for the caller and not a guarantee to this file.
//
// Both authorize with `requireEventRole(eventId, 'admin')` here, in the action, for the reason
// ./actions.ts states: capability comes from EventMemberships on every call, and a layout is not
// a security boundary. `admin` and not `reviewer`, matching every other dashboard write.
//
// There is no `ownedDashboard` step, because neither action names an existing dashboard: one
// reads nothing and the other creates a row whose event link this code supplies.

import { isAppError } from '@/constants/errorIds'
import { requireEventRole } from '@/features/auth/wiring'
import type { DashboardActionResult } from '@/features/dashboard/actions'
import {
  type DashboardProposal,
  PROPOSAL_CONTEXT,
  PROPOSAL_DESCRIPTION_LIMIT,
  PROPOSAL_MAX_TOKENS,
  PROPOSAL_SCHEMA,
  PROPOSAL_SYSTEM,
  proposalQuestion,
  proposalWidgets,
  validateProposal,
} from '@/features/dashboard/ai-proposal'
import { mockProposal } from '@/features/dashboard/ai-proposal-mock'
import { dashboardTabs } from '@/features/dashboard/dashboard-tabs'
import { AI_SAMPLE_NOTICE, getAiClient, isAiMocked } from '@/services/ai'
import { createDashboard } from '@/services/airtable/mutations-dashboards'
import { listDashboards } from '@/services/airtable/reads-dashboards'

export type DashboardProposalResult =
  | {
      ok: true
      proposal: DashboardProposal
      /**
       * `AI_SAMPLE_NOTICE` when the answer was canned, absent when it came from the model.
       *
       * Returned rather than read in the component, because the component is a client one and
       * `isAiMocked()` reads the Workers env. Sending the string is also what keeps
       * `@/services/ai` (and the Anthropic SDK behind it) out of the browser bundle.
       */
      notice?: string
    }
  | { ok: false; message: string }

/**
 * Describe a dashboard, get one proposed. Nothing is written.
 *
 * The prompt carries the widget catalogue and the organizer's sentence, and deliberately not the
 * event snapshot: choosing among eight fixed aggregates does not need this event's submissions,
 * and sending them would be event data in a prompt with no use for it. See ai-proposal.ts.
 */
export async function proposeDashboardAction(
  eventId: string,
  description: string,
): Promise<DashboardProposalResult> {
  try {
    await requireEventRole(eventId, 'admin')

    // Cut before it is sent, not after: the budget is a real cap and a pasted essay would spend
    // it on text the answer cannot use. The same limit the description column holds.
    const asked = description.trim().slice(0, PROPOSAL_DESCRIPTION_LIMIT)
    if (asked === '') return { ok: false, message: 'Describe the dashboard you want.' }

    const answer = await getAiClient().complete<unknown>({
      system: PROPOSAL_SYSTEM,
      context: PROPOSAL_CONTEXT,
      question: proposalQuestion(asked),
      schema: PROPOSAL_SCHEMA,
      maxTokens: PROPOSAL_MAX_TOKENS,
      // Picking widgets off a list of eight is not a reasoning problem, and the whole modal is
      // waiting on this call.
      effort: 'low',
      mock: () => mockProposal(asked),
    })

    // The mock goes through this too. A canned proposal that could not be created would be a
    // fixture demonstrating a flow that does not work.
    const checked = validateProposal(answer)
    if (!checked.ok) return { ok: false, message: checked.message }

    return {
      ok: true,
      proposal: checked.proposal,
      ...(isAiMocked() ? { notice: AI_SAMPLE_NOTICE } : {}),
    }
  } catch (error) {
    // Prefixed, because the boundary's messages are written as fragments for a log line
    // ("the model declined this request") and this one lands in a toast.
    if (isAppError(error)) {
      return { ok: false, message: `Could not propose a dashboard: ${error.message}.` }
    }
    throw error
  }
}

/**
 * Create the previewed proposal: one dashboard plus the widgets it named.
 *
 * The order computation and the returned `href` are `createDashboardFromTemplateAction`'s,
 * deliberately identical. Both compute the new tab from the list as it was BEFORE the write plus
 * the row just created, rather than re-reading: the write has already expired
 * `event:{id}:dashboards`, and asking for it again inside the same request is asking whether
 * Next has finished expiring it yet. The new row sorts last, so appending it reproduces exactly
 * the strip the next request renders. Two ways of computing that href would be two chances for
 * the URL and the tab strip to disagree.
 */
export async function createDashboardFromProposalAction(
  eventId: string,
  proposal: DashboardProposal,
): Promise<DashboardActionResult> {
  try {
    await requireEventRole(eventId, 'admin')

    // Re-validated: this object arrived over the wire, and the organizer has had a chance to
    // remove widgets from it since it was checked. See the header.
    const checked = validateProposal(proposal)
    if (!checked.ok) return { ok: false, message: checked.message }

    const existing = await listDashboards(eventId)
    const order = existing.reduce((highest, row) => Math.max(highest, row.order), 0) + 1
    const created = await createDashboard(
      {
        eventId,
        name: checked.proposal.name,
        color: checked.proposal.color,
        description: checked.proposal.description,
        // No `templateKey`: this dashboard did not come from a gallery card, and stamping one on
        // it would make the tab claim a template whose widget set it does not have.
        order,
      },
      proposalWidgets(checked.proposal.metrics),
    )

    const tab = dashboardTabs(eventId, [...existing, created]).find(
      (candidate) => candidate.dashboardId === created.id,
    )
    return {
      ok: true,
      message: 'Dashboard created.',
      href: tab?.href ?? `/admin/${eventId}`,
    }
  } catch (error) {
    // ./actions.ts's rule, unchanged: an `AppError` carries a message written for a human, and
    // anything else is a genuine fault that belongs in the logs rather than in a toast.
    if (isAppError(error)) return { ok: false, message: error.message }
    throw error
  }
}
