# Phase 76h: video prompts

The last item of phase 76 in [market-gaps-2026-10.he.md](../research/market-gaps-2026-10.he.md):
a short video answer to a prompt (Hinge, 2022). Video is the riskiest media on a dating app
(nudity, other people's faces, location in metadata, malware in containers), so this phase is built
security-first: **nothing anyone uploads is shown before a moderator approves it.**

## What

- **On my profile**: one video, up to **30 seconds**, answering one of the prompts ("A perfect
  Sunday looks like…"). Upload a file (the app records or picks one); replace or remove it any time.
- Until approved I see "Waiting for review"; if rejected, a short reason.
- **On someone's profile**: a poster image with a play button; the video plays with controls, no
  autoplay, muted until the viewer turns sound on. Captions aren't generated (no AI on the audio);
  the prompt is the text alternative.
- **Dashboard → Videos**: moderators watch each new video and approve or reject it (with a reason
  from a list), audited.

## Pipeline (worker)

1. Upload goes to the **quarantine** bucket (never served), status `quarantine`.
2. **ClamAV** scan; malware → rejected, deleted.
3. **Sniff by magic bytes** (MP4/MOV, WebM/Matroska only); ffmpeg is run with that **one demuxer
   forced**, no shell, a timeout and an output size cap.
4. **Re-encode**: H.264 + AAC in MP4, at most 720 px and 30 fps, hard cut at 30 s, **all metadata
   and chapters dropped** (GPS, device, dates), faststart. The original is deleted.
5. A **poster** frame, re-encoded with sharp; its perceptual hash is checked against banned photos
   (phase 21).
6. Status `review`: a moderator approves (`clean`, shown) or rejects (`rejected`, media deleted).

## Design

| Part   | Change                                                                                                                                           |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| shared | `video.ts`: limits, `myVideoSchema`, `publicProfile.videoPrompt`, admin review schemas                                                           |
| db     | `profile_videos` (one per member; status, keys, duration, reason, reviewer)                                                                      |
| worker | `video.ts` (sniff, ffmpeg args, transcode, poster) and a `process-video` job                                                                     |
| api    | `POST/GET/DELETE /v1/me/video`; `GET /v1/videos/:id` (with **Range**, for iOS) and `/poster`, only for approved videos and people who may see the owner; admin `GET /v1/admin/videos`, `POST /v1/admin/videos/:id/decision`, staff-only file access |
| mobile | (76h-b) upload, status, player on the profile card                                                                                               |
| admin  | (76h-b) Videos review page                                                                                                                       |

## Security, privacy, accessibility

- Every upload: size limit (40 MB), rate limit, authenticated; served only after review; access
  checked per request (`canView`), `nosniff`, no caching by shared caches.
- Metadata stripped by re-encoding; the original never leaves quarantine and is deleted.
- Reports of a member include their video (moderators can open it).
- Retention: deleted with the account or when replaced; rejected media deleted at once.
- ⚖️ Faces of other people / minors in a video: covered by the moderators' review rules.
- Accessibility: the player has labelled controls, no autoplay, the prompt as its text alternative.

## Tests

- Worker unit tests: ffmpeg arguments (forced demuxer, metadata dropped, limits); a real transcode
  of a generated test clip (metadata gone, ≤30 s, ≤720 px).
- Integration: upload → quarantine → (worker) → review → approve → served with Range to someone who
  may see the owner, 404 to others and before approval; reject; replace; delete; export; account
  deletion.
- e2e (76h-b): upload in the app, approve in the dashboard, play on the profile; axe 0.
