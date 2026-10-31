# Phase 75c: A short interview to start your profile (v1.63)

> Status: ✅ done (2026-10-31). ⚖️ = needs legal review.
> From `docs/research/market-gaps-2026-10.he.md`, item 75, part 1: an onboarding interview that
> fills profile fields. **The AI doesn't write the profile**: it suggests, the person decides.

## What's here today (checked in the code)

- Profiles have up to 3 prompt answers (phase 2) and "about me" fields: interests, children,
  smoking, drinking (phase 19), filled in on separate screens.
- The Profile Coach (phase 5) gives tips, and bio drafts with a model; the matchmaker (phase 23)
  turns someone's own words into settings with a strict, validated JSON reading.

## Decisions

- **Questions that are prompts:** "My perfect Sunday", "I could geek out about", "Simple pleasures"
  and "What I'm looking for". Each answer can become a prompt answer **in the person's own words**,
  word for word: nothing is rewritten.
- **The AI only proposes fields:** where the community has a text model (an external one only with
  the person's own `ai_cloud` consent; only their own words are sent), it reads the answers into
  interests, children, smoking and drinking, each validated against the app's own lists; the
  person ticks what to keep. Answers with contact details or abuse aren't sent. Never religion,
  identity or health. Without a model the interview still works, as an easy way to write prompts.
- **Voice:** the device's own dictation in the answer box; nothing is recorded by the app.
- **Nothing new is stored** beyond what the person chooses to save to their profile.

## What changes

| Part                                     | Change                                                                                                                                                                              |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Profile → "Start with a short interview" | Four questions, one at a time (skip any). Then: which answers to add as prompt answers (up to 3, replacing the same question), and suggested interests and lifestyle to tick. Save. |

## Tests

- Unit (ai): the reading keeps only valid values; contact details or abuse aren't sent.
- Integration: suggestions from a fake model (only the person's own answers sent, validated
  values only); unavailable without a model; external model needs the person's consent; limits.
- e2e (en, he): the interview, the review, saving prompts and interests. axe 0. Screenshots.

## Done

- **Unit** (`packages/ai/test/interview.test.ts`): only valid values kept, each field on its own
  (an unknown interest, a wrong drinking value and "religion" dropped); answers with contact
  details or links are never sent.
- **Integration** (`interview.test.ts`, a recording fake model): only the person's own answers are
  sent (not the name, account, gender or location); only valid values come back; nothing is saved
  by asking; answers validated (interview questions only, length, no extra fields); an external
  model needs her own consent (not her matches'); 20 a day.
- **e2e** `pnpm --dir e2e interview` (en, he), with the local stand-in model: two answers, two
  skipped; one kept as a prompt answer word for word, the other not; one suggested interest
  ticked and saved, the others not. axe 0. Screenshot `194-interview-review`.
- Docs: AI.md, PRIVACY.md, CHANGELOG, README.

### Not done here

- Recorded voice answers (the device's own dictation works in the answer box), and the AI
  matchmaker in a shared chat (item 75, part 5).
