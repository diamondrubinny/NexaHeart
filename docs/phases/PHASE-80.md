# Phase 80: captions for video prompts

Video prompts (phase 76h) shipped without captions: the prompt was the only text alternative. A
member who is deaf or hard of hearing, or anyone with the sound off, gets nothing from the spoken
answer (WCAG 1.2.2, captions for prerecorded video). The server already has a local speech model
for voice messages (phase 26); this phase uses it to caption videos.

## What

- **Automatic captions**: after a video is re-encoded, the worker transcribes its sound track on
  this server (the same local Whisper model as voice transcripts) into timed lines. Nothing is
  sent anywhere.
- **Reviewed with the video**: the video goes to the moderators only once its captions are ready
  (or failed, or aren't wanted), so the captions are approved together with it. Moderators see the
  lines next to the player, and a note when the harm filter flags them.
- **The owner is in charge of the words**: on "My video" the owner reads the lines, corrects them
  (automatic captions make mistakes, more so in Hebrew and Arabic), or turns captions off.
  Corrected lines are harm-checked; changing them on an approved video sends it back for review
  (nothing unreviewed is ever shown). Turning them off needs no review.
- **For viewers**: a captions track in the web player (on by default) and the same lines as text
  under the video ("Show the words"), which also works in the native apps.
- **Respecting choices**: no captions when the community turned transcripts off
  (`TRANSCRIPTS=off`) or the owner chose "voice only" (the phase 26 preference).

## Design

| Part   | Change                                                                                                                                                                                          |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| shared | `video.ts`: cue and captions schemas, limits, `cuesToVtt` (escaped), `normalizeCues`; `videoPrompt.captions`; `ProcessCaptions` job                                                             |
| db     | `profile_videos`: `lang`, `captions` (jsonb), `captions_status`, `caption_flags` (migration 0095)                                                                                               |
| worker | `Transcriber.transcribeTimed`; `processVideo` hands over to a captions job (status stays `processing`), which ends in `review`; the last failed attempt also ends in `review`, without captions |
| api    | `POST /v1/me/video?lang=`; `PUT /v1/me/video/captions` (edit or turn off); captions in my video, in profiles (approved only), in the review queue and in the export                             |
| mobile | captions track (web) and "Show the words"; the editor on `/video`                                                                                                                               |
| admin  | the lines and the flag note in the review queue                                                                                                                                                 |

## Security, privacy, accessibility

- **Threats**: (1) offensive text slipped in through captions after approval → an edit on an
  approved video returns it to review; edits are harm-checked and plain text only (no control or
  bidi characters). (2) WebVTT injection (`-->`, tags, extra cues) → the text is escaped when the
  track is built, and tested. (3) Resource use → one clip at a time on the existing transcribe
  queue, at most 30 s of audio, bounded line count and length. (4) A stuck pipeline → the last
  failed attempt releases the video to review without captions.
- **Privacy**: the words of a video are personal data (and may reveal more than the picture):
  stored with the video, deleted with it, in "Download my data", never federated, made only
  on this server. Covered by the existing transcripts choice ("voice only").
- **Accessibility**: captions on by default, a text version of the same words, the editor is plain
  labelled text fields; ⚖️ automatic captions aren't guaranteed accurate, so the owner can correct
  them and the accessibility statement should say they're automatic.

## Tests

- Unit (shared): `cuesToVtt` escaping and timing; `normalizeCues` bounds.
- Integration: upload → captions job (fake transcriber) → review with captions → approve → the
  viewer gets them; owner edits (harm-checked; back to review when approved); turn off; "voice
  only" and transcripts off; a failed captions job still reaches review; export; flags only for
  staff.
- e2e (en, he): upload a clip with real speech, the worker captions it, the moderator sees the
  lines, the viewer gets a captions track and the text; axe 0.

## Done

- **Shared:** cue and captions schemas, `normalizeCues` (clean, in order, short lines), `cuesToVtt`
  (escaped), `captionsInputSchema`; `videoPrompt.captions`; the `caption-video` job.
- **Migration 0095:** `profile_videos.lang`, `captions`, `captions_status`, `caption_flags`.
- **Worker:**
  - `transcribeTimed` on the local Whisper model (timed chunks).
  - `processVideo` hands the video over to the captions job; the video reaches `review` when the
    job ends, with or without captions.
  - A video never waits for its captions: the last failed attempt, a queue that's down, or 15
    minutes without an answer all release it to review.
- **API:**
  - `POST /v1/me/video?lang=`; `PUT /v1/me/video/captions` (correct the lines, or `null` to turn
    them off).
  - Captions in my video, in profiles (approved only), in the review queue (with the harm
    filter's note) and in the export.
  - An approval names the words the moderator saw (`captionsVersion`); if the owner changed them
    meanwhile it's refused.
- **App:** a captions track in the web player, on by default; "Show the words" under the video
  (also in the native apps); the editor on "My video".
- **Dashboard:** the lines and the flag note next to each video in review.
- **Found on the way, fixed:** the editor started with no lines when the screen was open while
  captions were being made (saving then failed); the owner's video address was returned before
  the video could be opened.
- **Docs:** the data map and the privacy policy drafts (the words of a video); the accessibility
  statement drafts (captions, and their limits).
- **Tests:** shared `video-captions.test.ts` (4); integration `video.test.ts` (11, 5 new); e2e
  `pnpm --dir e2e video` (en, he) with the real speech model: the model hears the sentence, the
  owner corrects it, the moderator reads it, the viewer gets the track and the text; axe 0.
- 📘 To check on real devices: the text version in the native apps. The speech model's quality in
  Hebrew and Arabic depends on the model the operator chooses (`TRANSCRIPTS_MODEL`).
- **Independent review (before merge):** no critical issue; every finding acted on:
  - An owner's edit could cross a moderator's approval and publish unreviewed words. Both now
    lock the row; new words always go to review; an approval must name the words it saw.
  - "Voice only" now also deletes captions already made; a rejection deletes them with the media.
  - The 15-minute wait is counted from when captions were queued, not from the upload.
  - Turning captions off asks first and says what happened; the text version carries its
    language; each line in the dashboard takes its own direction.
  - Only the lines the owner changed are harm-checked, and the note for moderators is kept.
  - Left as is, and said in the accessibility statement drafts: the native apps show the words as
    text, not over the video; a video whose captions failed can't be captioned by hand; the
    language is the app's language at upload.
- **Migration 0096:** `captions_requested_at`.
