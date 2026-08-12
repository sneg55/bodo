# Airtable migrations

Airtable schema changes as data, applied by a script rather than clicked into the
UI, so a judge or another builder can recreate the base with one command.

`BUILD_SPEC.md` §3 is the source these declarations are transcribed from.

## What is here

- `schema-types.ts` builds one Meta API field definition per type, so a format or a
  precision is spelled once.
- `tables-core.ts`, `tables-review.ts`, `tables-portal.ts`, `tables-comms.ts`
  declare all 29 tables from §3. Column names come from `COL`, never a literal, so
  the migration and the DAL cannot drift.
- `001-initial-schema.ts` composes them and carries the list of places §3 is
  ambiguous, with the choice made for each.
- `diff.ts` is the pure planner: existing schema plus desired schema in, list of
  things to create out. It never proposes a deletion or a type change.

Applied by `scripts/airtable-schema.ts` (`npm run airtable:schema`, or
`airtable:schema:plan` to diff and write nothing). `scripts/seed.ts` then populates
the §10 scenario.

## Two things that are easy to get wrong here

**Links need two passes, not a clever ordering.** The table graph genuinely has
cycles: `Files` links to `FileRequestAssignments`, which links to `Submissions`,
which links to `Tracks`. So pass one creates every table with its scalar columns,
and pass two adds every link once all the targets exist. No declaration order can
substitute for that, which is why `tests/migration-apply.test.ts` drives an
in-memory base that rejects a link to a table that does not exist yet: a
regression to a single pass fails there rather than halfway through a real base.

**Nothing here has run against a real base.** There are no Airtable credentials in
the development environment, so every field type and `options` payload is declared
but unproven, and whether `dateTime` is legal as a primary field is the most likely
first failure (§3's column order opens with a link on eight tables, and Airtable
forbids a link, select, or checkbox as primary, so those tables lead with their
first legal column instead). Verify in this order, and expect the second and fourth
commands to report zero work:

    npm run airtable:schema:plan
    npm run airtable:schema
    npm run airtable:schema
    npm run airtable:seed
    npm run airtable:seed

The token needs `schema.bases:read`/`write` for the schema step and
`data.records:read`/`write` for the seed. Scopes alone grant nothing: the base, or its
whole workspace, has to be added under **Access** on the token's own page, which is a
separate panel from Scopes. A token with the right scopes and no Access entry
authenticates fine and reports zero bases, which is what it looks like when this is
wrong.

The base itself can be created in the UI or by `POST /v0/meta/bases` with a
`workspaceId`. What the Metadata API genuinely cannot create is an `autoNumber`, so
`Submissions.code` is added by hand once per base and the schema script reports it on
every run until it exists.

## Before seeding a base somebody will demo from

Set `SEED_EMAIL_DOMAIN` to a domain that accepts mail. The default `example.com` is
right for offline work, since RFC 2606 reserves it and nothing seeded can then mail a
stranger, and wrong for a demo: **Resend refuses that domain by name**, answering 422
with "Please use our testing email address instead of domains like `example.com`".

A magic link IS the login (BUILD_SPEC 4), so seeded speakers on the default domain can
never receive a sign-in link and the §10 walkthrough cannot be performed as a speaker.

## Two rules

- One file per migration, numbered, never edited after it has been applied to a
  base someone else has. A base that cannot be rebuilt from this directory is a
  base nobody else can run the project against.
- The uniqueness constraints in §3 (`SubmissionParticipants`, `ReviewAssignments`,
  `SubmissionRounds`, `TaskAssignments`, `FileRequestAssignments`,
  `ReviewTeamMembers`, `IntegrationMappings`, `Forms.publicId`, and
  `EmailOutbox.idempotencyKey`) are enforced in application code, because Airtable
  has no unique index. The declaration records them so the DAL and the migration
  cannot disagree about what the key is.
