# Phase 78: the data map catches up, and can't fall behind again

Phases 76a-76h added new personal data (prompt polls and picks, the question game, interest groups
with posts and departures, member-proposed groups and secret crushes, songs, video prompts), but
`docs/PRIVACY.md`, the operator's data map, and the privacy policy drafts weren't updated. An
operator who relies on them would publish an incomplete privacy policy ⚖️.

## What

1. **`docs/PRIVACY.md`**: a row for each new kind of data (what, why, legal basis, retention), the
   new processors and recipients (none: video is processed on the server), the storage-limitation
   jobs (group departures, crushes), the DPIA screening (video: faces and voices; groups: they can
   reveal sensitive things).
2. **An appendix listing every database table**: the data-map row it belongs to, or why it holds no
   personal data.
3. **A test that fails when a table is missing from the appendix** (or the appendix names a table
   that no longer exists). A new table can't ship without a line in the data map.
4. **Privacy policy drafts (en, he)**: the same new data in members' words, marked as drafts for
   legal review.

## Security, privacy, accessibility

- Documentation and a test only; no change to what is collected.
- Wording: plain, no claim of compliance; ⚖️ where a lawyer must decide (groups that reveal
  sensitive data, video review), 📘 where something needs checking against official text.
- Hebrew: gender-neutral, no slash forms.

## Tests

- `apps/api/test/data-map.test.ts`: every table in `@nexaheart/db` is in the appendix, and every
  table in the appendix exists.

## Done

- `docs/PRIVACY.md`:
  - New rows: weekly rose and lenses, question game, prompt poll, interest groups, groups members propose and secret crushes, my song, video prompt.
  - Two older rows that were missing: read receipts (phase 30) and availability in a chat (phase 20).
  - Object storage now lists video; the daily jobs list departures, crushes and removed posts; the DPIA screening covers images of people and groups that can reveal sensitive data.
  - New appendix listing all 100 tables.
- `apps/api/test/data-map.test.ts`: fails on a table missing from the appendix (checked by removing `profile_videos`) or on one listed that doesn't exist.
- Privacy policy drafts (en, he): the new data in members' words, ⚖️ where a lawyer must decide.
