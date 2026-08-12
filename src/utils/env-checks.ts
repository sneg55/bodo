// Cross-field env validation: the rules a single field cannot express.
//
// Split out of env.ts when it crossed the file-size limit. These are the checks that stop
// a deploy which parses cleanly and still cannot do its job, so each one names the
// failure it prevents rather than the rule it enforces.

import type { EnvInput } from '@/utils/env-schema'

export type Ctx = { addIssue: (issue: { code: 'custom'; path: string[]; message: string }) => void }

/**
 * What a production deploy must have, and what it must not have.
 *
 * Two halves. The first is presence: config a real user would hit. The second is
 * usability, which is the failure mode presence alone misses, since a deploy that passes
 * the required-keys check and still cannot send a working link has only moved the error
 * from config time to the first speaker who tries to log in.
 */
export function checkProduction(env: EnvInput, ctx: Ctx): void {
  // Spelled out as pairs rather than indexed by key name so the list stays type-checked
  // against the schema.
  const required: readonly (readonly [string, unknown])[] = [
    // Without a real origin, magic links, portal links, and .ics URLs are wrong.
    ['APP_URL', env.APP_URL],
    ['AIRTABLE_TOKEN', env.AIRTABLE_TOKEN],
    ['AIRTABLE_BASE_ID', env.AIRTABLE_BASE_ID],
    ['SESSION_SECRET', env.SESSION_SECRET],
    // Magic-link auth IS the login flow, so email is not an optional subsystem:
    // no email means nobody can sign in at all.
    //
    // Unless demo mode is on, which is the one configuration where that premise is
    // false: /api/auth/demo signs a visitor in without sending anything, so a demo
    // deployment with no mailbox is fully usable rather than stranded. Only these
    // two keys are relaxed. Everything else on this list still fails a deploy,
    // because a demo that cannot reach its base or sign a cookie is not a demo.
    //
    // The key named is the one the chosen provider needs. It was RESEND_API_KEY
    // unconditionally, which would have failed a production deploy that had correctly
    // configured AgentMail and demanded a Resend key it has no use for.
    ...(env.DEMO_MODE
      ? []
      : ([
          env.EMAIL_PROVIDER === 'agentmail'
            ? (['AGENTMAIL_API_KEY', env.AGENTMAIL_API_KEY] as const)
            : (['RESEND_API_KEY', env.RESEND_API_KEY] as const),
          ['EMAIL_FROM', env.EMAIL_FROM],
        ] as const)),
    // Public reads for headshots and slides.
    ['R2_PUBLIC_BASE_URL', env.R2_PUBLIC_BASE_URL],
    // /api/cron/* is an open URL until this is set.
    ['CRON_SECRET', env.CRON_SECRET],
  ]
  for (const [name, value] of required) {
    if (value === undefined) {
      ctx.addIssue({ code: 'custom', path: [name], message: 'required when DEPLOY_ENV=production' })
    }
  }

  // http would make every emailed magic link plaintext, and the session cookie is
  // Secure, so the link would not even establish a session.
  if (env.APP_URL !== undefined && !env.APP_URL.startsWith('https://')) {
    ctx.addIssue({
      code: 'custom',
      path: ['APP_URL'],
      message: 'must be an https origin in production',
    })
  }

  // The resend.dev test domain only delivers to the Resend account owner, so with
  // magic-link auth it means nobody except the owner can log in. See BUILD_SPEC 7.3.
  if (env.EMAIL_FROM?.trim().toLowerCase().endsWith('resend.dev') === true) {
    ctx.addIssue({
      code: 'custom',
      path: ['EMAIL_FROM'],
      message:
        'resend.dev only delivers to the account owner, so no speaker could log in: use a verified domain',
    })
  }
}

/**
 * Rules that hold at every DEPLOY_ENV: an adapter that does not exist, and the two
 * mock flags that promise a live integration.
 *
 * Feature-conditional rather than blanket. An integration is only a dependency once it
 * stops being mocked, so a local clone owes neither key and a deployment that turned a
 * mock off owes exactly the one it turned off.
 */
export function checkFeatureFlags(env: EnvInput, ctx: Ctx): void {
  // A provider with no adapter must fail here rather than at the first send. The
  // switch itself is deliberate (BUILD_SPEC 7.3 keeps the Cloudflare swap to one
  // file), but a value that validates and then throws on every message is a deploy
  // that looks configured and cannot deliver a single magic link.
  if (env.EMAIL_PROVIDER === 'cloudflare') {
    ctx.addIssue({
      code: 'custom',
      path: ['EMAIL_PROVIDER'],
      message:
        'the cloudflare adapter is not implemented (attachment support is undocumented, see BUILD_SPEC 7.3): use resend',
    })
  }

  // Naming a provider is promising it, the same way turning a mock off is. Without this
  // the deployment falls back to logging every message, which reads as "nothing was sent
  // yet" rather than "this is misconfigured" and is indistinguishable from a quiet queue.
  if (env.EMAIL_PROVIDER === 'agentmail' && env.AGENTMAIL_API_KEY === undefined) {
    ctx.addIssue({
      code: 'custom',
      path: ['AGENTMAIL_API_KEY'],
      message: 'required when EMAIL_PROVIDER=agentmail',
    })
  }

  if (!env.ACCELEVENTS_MOCK && env.ACCELEVENTS_API_KEY === undefined) {
    ctx.addIssue({
      code: 'custom',
      path: ['ACCELEVENTS_API_KEY'],
      message: 'required when ACCELEVENTS_MOCK=0',
    })
  }

  // Same pairing, same reason: turning the mock off is the act of promising a live model.
  if (!env.AI_MOCK && env.ANTHROPIC_API_KEY === undefined) {
    ctx.addIssue({
      code: 'custom',
      path: ['ANTHROPIC_API_KEY'],
      message: 'required when AI_MOCK=0',
    })
  }
}
