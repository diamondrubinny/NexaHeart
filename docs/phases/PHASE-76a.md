# Phase 76a: A weekly rose (v1.64)

> Status: ✅ done (2026-10-31).
> From `docs/research/market-gaps-2026-10.he.md`, item 76 (formats and discovery), part 3: a
> **free weekly rose**, a rare, highlighted signal, with no payment. "Secret crush" from shared
> events (part 7) already exists as "Meet again" (phase 71a); groups and lenses come later.

## What's here today (checked in the code)

- A like can point at a photo or prompt and carry a comment (phase 2); it shows in the other
  person's Likes, newest first. There's no way to say "you stand out" more strongly, and nothing
  can be bought.

## Decisions

- **One rose every 7 days, free, for everyone**, as a community setting (on by default; Dashboard
  → Branding → Community). Rarity is what makes it mean something, and nobody can buy more.
- **It's a like:** the same rules (dating mode only, filters both ways, daily limits, "your turn").
  It can carry the same comment.
- **On the other side:** roses come first in Likes, marked 🌹. Nothing else changes: no push, no
  ranking boost in anyone's deck.

## What changes

| Part                  | Change                                                                                               |
| --------------------- | ---------------------------------------------------------------------------------------------------- |
| Deciding on a profile | "🌹 Send a rose" next to Like while this week's rose is unused; afterwards, when the next one comes. |
| Likes                 | Roses first, with a 🌹.                                                                              |
| Dashboard             | Branding → Community: "A free rose every week".                                                      |

## Tests

- Integration: one per 7 days (the second refused, the next after a week); dating mode only; off
  when the community turns it off; it's a like (a match when mutual); roses first in Likes; the
  status (available / next).
- e2e (en, he): send a rose; the other person sees it first, marked. axe 0. Screenshots.

## Done

- **Integration** (`rose.test.ts`): available at first; a rose with a comment comes first in Likes,
  before an earlier plain like; a second rose the same week is refused (a plain like isn't); the
  status gives the next one, about a week ahead; after a week, a new one; still a like (a mutual
  like is a match); a pass or friends mode can't carry a rose; turned off by the community:
  disabled and refused.
- **e2e** `pnpm --dir e2e rose` (en, he): Dan sends his rose from Noa's profile; on another profile
  he sees when the next one comes; Noa sees the rose first in Likes, marked 🌹. axe 0. Screenshot
  `195-likes-rose`.
- Docs: CHANGELOG, README. Nothing new about anyone is stored beyond the like itself.

### Not done here (76b and later)

- Discovery lenses set by the community, interest groups, the question bank and the question game
  in chat, prompt polls and video prompts.
