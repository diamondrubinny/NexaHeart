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
