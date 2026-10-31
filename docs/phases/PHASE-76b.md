# Phase 76b: Discovery lenses (v1.65)

> Status: 🚧 in progress.
> From `docs/research/market-gaps-2026-10.he.md`, item 76, part 1: discovery lenses the operator
> sets, in the spirit of Tinder's "Modes", as switches in the community's settings.

## What's here today (checked in the code)

- Discover shows one ranked deck (phase 2): the filters both ways, then five signals (vibe,
  intention, languages, distance, activity) and fairness. Picks (phase 2) and "Why you might
  click" explain it. Members can't ask for a slice of it.

## Decisions

- **A lens narrows the same deck; it never widens it.** Every filter both ways, block, pause,
  receiver-side protection and fairness rule still applies; a lens only keeps the people who fit
  it, in the same order. No new data about anyone.
- **Five lenses, from what's already known:** shared interests; nearby (within 5 km); new here
  (joined in the last 2 weeks); the same goal (the same intention; marriage and long-term count
  as one); shows up (phase 70: people who came to the dates and events they said yes to).
- **The community chooses which to offer** (Dashboard → Branding → Community, all on by default),
  so a small community can keep only the ones that help.

## What changes

| Part      | Change                                                                                                           |
| --------- | ---------------------------------------------------------------------------------------------------------------- |
| Discover  | A row of lens chips under the deck switch: "Everyone" and the community's lenses. The deck reloads for the lens. |
| Dashboard | Branding → Community: which lenses to offer.                                                                     |

## Tests

- Integration: each lens keeps only who fits it, from the same deck; a lens the community turned
  off is refused; the filters both ways still apply under a lens.
- e2e (en, he): pick a lens in Discover; the dashboard setting. axe 0. Screenshots.

## Done

- Shared `discoveryLenses`, `discover?lens=`; `instance_settings.discovery_lenses` (migration
  0085); `fitsLens` filters the candidates before scoring; a lens the community doesn't offer is a 400.
- Discover: an "Only" row of lens chips (its own label, so it isn't confused with the deck switch);
  an empty lens says to try another. Dashboard: Branding → Community checkboxes.
- Tests: integration `lenses.test.ts` (3); e2e `pnpm --dir e2e lenses` (en, he), axe 0;
  screenshots `196-discover-lens`, `admin-19-lenses`.
- Next: interest groups, the question game in chat, prompt polls and video prompts.
