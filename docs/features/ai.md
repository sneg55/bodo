# AI features

Three surfaces, each answering a question an organizer already has, and all three built so
that a clone with no API key still demonstrates them.

## Ask (⌘K)

The command palette does two things. It navigates, and it answers questions about the event
in prose: "which accepted speakers still owe slides", "what came in through the workshop
form this week".

**The citations are the safety property, and they are the reason the feature is shaped the
way it is.** The model answers in prose and cites record ids. Nothing it writes becomes a
link unless the id resolves against the exact rows the snapshot was built from. An invented
id, a real id copied out of a title, a speaker id arriving tagged as a submission: each
resolves to nothing and is dropped.

So the worst a hallucination can do is leave an answer with fewer rows under it than it
deserved. It can never produce a link into a record that does not exist, or into one the
asker was not allowed to see.

The snapshot caps each section, and resolution happens against **the capped snapshot**, not
against the underlying read, so an id past the cap cannot resolve by luck.

## Pre-screen

A whole review round can be pre-screened by Claude, producing reviews attributed to an AI
reviewer that are visible as such everywhere a human review appears.

It is a **queue drained by cron**, not an inline action, because a round is tens of
submissions and a Workers request cannot hold open for tens of model calls.

Three orderings in the job are load-bearing:

1. **Claim before anything else**, per (round, submission) rather than per job row. The thing
   that must not happen twice is one submission being scored twice, because a review is keyed
   on (submission, round, reviewer) and a double run would overwrite a review with a second
   opinion from the same reviewer, invisibly.
2. **Stamp the attempt before the call.** A Worker cancelled mid-request never reaches an
   "after", so an attempt counted on the way out is one a job that always dies would never
   accumulate, and the retry cap would not hold.
3. **Release the claim after the outcome is written**, so the next tick cannot pick up a job
   in a state this one has not finished recording.

The round's criteria become a JSON schema, so the model answers in the rubric the organizer
authored rather than in one of its own. Unknown criterion keys are dropped rather than
rejecting the whole review, because criteria are editable after a pre-screen is queued and
losing a submission's whole score over one stale key is worse than a review with one fewer
criterion. Out-of-range scores are clamped, the same rule stored history uses.

An organizer can **override an AI score**, and the override persists and stays
distinguishable from the original.

## Dashboard proposal

Describe what you want to see and get a dashboard built from the widget catalogue. It cannot
invent a metric that does not exist; it selects and arranges. See
[Dashboards](dashboards.md).

## Running without a key

All three run **canned by default**. `AI_MOCK=1` is the shipped default, and in that mode
each surface produces output labelled as a sample wherever it renders. Ask and pre-screen
compute theirs from the event's own rows, so a fresh clone with an empty `.env` demonstrates
them against its own seeded data.

The dashboard proposal is the exception, and deliberately: choosing among eight fixed
aggregates needs the catalogue and the organizer's sentence and nothing else, so **its prompt
never carries the event snapshot** even in the live path. Sending submission titles and
speaker addresses to a model that has no use for them buys nothing.

Going live is two settings, not one: `AI_MOCK=0` **and** `ANTHROPIC_API_KEY`. The flag
selects the client and the env schema requires the key once the flag is off, so the two
cannot drift apart.

The mock is fed the same rows as the real path, so its citations resolve through the same
resolver. That is what makes the mock a demonstration of the feature rather than a picture
of one.

## The boundary

`src/services/ai/` is the only directory allowed to import the Anthropic SDK, enforced by
lint, and `client.ts` inside it is the only file that calls the model. Same reason the
Airtable SDK is fenced off: a boundary anyone can reach around stops being one.

It has one call shape and one model (`claude-opus-5`), and it distinguishes the three
response shapes that are not answers: a **refusal** is a decision the model made, a
**truncation** is a budget this code set too low, and **unparseable text** is a bug.
Collapsing them into one error sends whoever is debugging to the wrong place.

The event snapshot carries the prompt-cache breakpoint and the question sits after it, so a
second question about the same event re-reads the digest from cache rather than paying for it
again. Every call is bounded in wall-clock time by constants that callers holding a lease can
read without importing the SDK.
