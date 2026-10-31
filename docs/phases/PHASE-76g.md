# Phase 76g: my song (a profile anthem)

Part of phase 76 in [market-gaps-2026-10.he.md](../research/market-gaps-2026-10.he.md). Tinder's
Anthem (and its Spotify connection) shows a song on the profile: an easy, warm conversation
starter. We do it **without connecting any music service**: no account linking, no embedded
player, no third-party script, nothing sent anywhere.

## What

- **On my profile**: one song: title (up to 80 characters) and artist (up to 80), written by me
  (Profile → "My song"). Edit or remove it any time.
- **On someone's profile**: "🎵 Title — Artist" under the bio, and in the profile preview.
- A song can be liked like a prompt: "♥" next to it opens the same like-with-a-comment
  composer, and the like says which part it was about.

## Design

| Part   | Change                                                                                                        |
| ------ | ------------------------------------------------------------------------------------------------------------- |
| shared | `anthem.ts`: `anthemSchema` (title, artist); `publicProfile.anthem`; like item type `anthem`                  |
| db     | `profile_anthems` (one per member, deleted with the account)                                                  |
| api    | `GET/PUT/DELETE /v1/me/anthem` (harm-checked, rate-limited); the song in profiles; a like on `anthem` checked |
| mobile | `/anthem` editor; the song on the profile card with a like button; "Liked your song" in Likes                 |

## Security, privacy, accessibility

- No integration with music services: nothing about the member reaches a third party (no OAuth,
  no listening history, no embedded player or tracking).
- The member's own words: harm-checked when saved; plain text everywhere (no links rendered).
- In the data export; deleted with the account. Partner communities don't get it (like polls).
- Accessibility: the song line is text with a labelled like button; RTL.

## Tests

- Integration: save/limits/harmful refused; the song in the public profile; a like on the song
  (and refused when there's no song); export; deletion.
- e2e (en, he): write my song; someone likes it with a comment; Likes says "liked your song";
  axe 0; screenshots.

## Done

- Shared `anthem.ts`; `publicProfile.anthem`; like item type `anthem` (`likeItemTypes`).
- Migration 0092: `profile_anthems` (with an `id` a like refers to), enum value `anthem`.
- API: `GET/PUT/DELETE /v1/me/anthem`; the song in profiles; a like on someone else's song id is
  refused; `song` in the data export.
- App: `/anthem` editor; the song on the profile card with a like button; "Liked your song".
- Security (77d, before merge, from an independent review): moderators now see the song and the
  poll in a report and in the approval queue; the harm check also reads "title artist" together
  (a phrase split across the two fields is caught); control and bidi characters are refused in
  songs and polls. Two wider fixes found on the way: the harm filter didn't catch telling someone to
  harm themselves ("kill yourself", in 4 languages), and lexicon words with letters the normalizer
  changes (й → и) had never matched (e.g. "тупой", "займи") — phrases are now normalized like the
  text.
- Tests: integration `anthem.test.ts` (5), `moderation.test.ts`; e2e `pnpm --dir e2e anthem`
  (en, he), axe 0; screenshot `202-anthem`.
