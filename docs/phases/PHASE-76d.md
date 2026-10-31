# Phase 76d: prompt polls

Part of phase 76 in [market-gaps-2026-10.he.md](../research/market-gaps-2026-10.he.md). A prompt poll
(as launched by Hinge in 2022) is an easy first move: a question with two or three answers on the
profile; someone who likes the profile can pick one, and the pick arrives with the like.

## What

- **On my profile**: one poll, a question (up to 120 characters) and 2-3 answers (up to 40 each),
  written by me. Edit or remove it any time (Profile → "A poll on my profile").
- **On someone's profile**: the poll shows as a choice. Picking an answer and liking sends the
  like with "Picked: …". Picking is optional, and only goes with a like (a pass sends nothing).
- **In my likes**: "Picked: <answer>" next to the like, so I know how to start.
- No counts and no results: nobody sees how many picked what (no popularity signal, nothing to
  game).

## Design

| Part   | Change                                                                                                                                                              |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| shared | `poll.ts`: `profilePollSchema` (question, 2-3 answers); `publicProfile.poll`; `interaction.pollChoice` (likes only)                                                 |
| db     | `profile_polls` (one per member); `interactions.poll_answer` (a copy of the picked answer, so a later edit doesn't change it)                                       |
| api    | `GET/PUT/DELETE /v1/me/poll`; harm check on the texts; the poll in the public profile; `pollChoice` checked against the target's poll; `likes` returns `pollAnswer` |
| mobile | `/poll` editor; the poll as radio choices on a profile card (DecisionPanel); "Picked: …" in Likes                                                                   |

## Security, privacy, accessibility

- Texts are the member's own words: harm-checked when saved (refused if harmful), shown with the
  same receiver-side protections as other profile text, deleted with the account, in the export.
- A pick is part of a like: the same rules (blocks, filters, limits) apply; the answer is copied as
  text so the owner can't edit it after the fact to change what someone "picked".
- No aggregate results are stored or shown.
- Accessibility: the poll is a radio group with a legend; "Picked: …" is plain text; RTL.

## Tests

- Integration: save (2-3 answers, lengths, duplicate answers refused, harmful refused); public
  profile shows it; like with a pick → the receiver's likes show it; a pick without a poll, out of
  range, or on a pass is refused; editing the poll later doesn't change a received pick; delete.
- e2e (en, he): write a poll; another member picks and likes; the likes list shows the pick; axe 0.

## Done

- Shared `poll.ts`; `publicProfile.poll`; `interaction.pollChoice` (likes only); `likeReceived.pollAnswer`.
- Migration 0087: `profile_polls`, `interactions.poll_answer`.
- API: `GET/PUT/DELETE /v1/me/poll` (harm-checked, rate-limited); the poll in profiles; a pick is
  checked against the target's poll and copied as text; `promptPoll` in the data export.
- App: `/poll` editor (back to the profile tab when opened from a link), the poll as a radio group
  with "No pick" in the decision panel, "Picked: …" in Likes.
- Tests: integration `poll.test.ts` (4); e2e `pnpm --dir e2e poll` (en, he), axe 0; screenshots
  `198-poll-editor`, `199-poll-pick`.
- Next: interest groups (76e), video prompts, Secret Crush in groups.
