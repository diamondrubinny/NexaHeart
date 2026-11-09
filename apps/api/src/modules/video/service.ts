// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { createHash } from 'node:crypto';
import { checkHarm } from '@nexaheart/ai';
import { schema, type Database } from '@nexaheart/db';
import {
  ErrorCode,
  transcriptLangSchema,
  type CaptionsInput,
  type CaptionStatus,
  type TranscriptLang,
  type VideoCaptions,
  type VideoCue,
  type AdminVideo,
  type MyVideo,
  type PromptKey,
  type VideoDecision,
  type VideoPrompt,
  type VideoRejectReason,
} from '@nexaheart/shared';
import type { Storage, StoredObject } from '@nexaheart/storage';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { fileTypeFromBuffer } from 'file-type';
import { audit } from '../../lib/audit.js';
import type { MediaQueue } from '../../lib/queue.js';
import { HttpError } from '../../plugins/error-handler.js';

const { profileVideos, profiles } = schema;

/** What phones and browsers record: MP4/MOV (iOS, Android, Safari), WebM/Matroska (Chrome, Firefox). */
const allowed = new Set([
  'video/mp4',
  'video/quicktime',
  'video/x-m4v',
  'video/webm',
  'video/x-matroska',
]);

export async function sniffVideoType(buffer: Buffer): Promise<string | undefined> {
  const detected = await fileTypeFromBuffer(buffer);
  return detected && allowed.has(detected.mime) ? detected.mime : undefined;
}

/** One plain byte range (`bytes=0-1023`, `bytes=100-`, `bytes=-500`); anything else is ignored. */
export function parseRange(header: string | undefined): string | undefined {
  if (!header) return undefined;
  const value = header.trim();
  return /^bytes=(\d{1,15}-\d{0,15}|-\d{1,15})$/.test(value) ? value : undefined;
}

export const videoUrl = (id: string) => `/v1/videos/${id}`;
export const posterUrl = (id: string) => `/v1/videos/${id}/poster`;
export const adminVideoUrl = (id: string) => `/v1/admin/videos/${id}/file`;
export const adminPosterUrl = (id: string) => `/v1/admin/videos/${id}/poster`;

/** Phase 77e: the quarantine key follows from the ids, so cleanup never depends on the column. */
export const videoQuarantineKey = (userId: string, videoId: string) =>
  `videos/${userId}/${videoId}`;

const langOf = (lang: string | null): TranscriptLang | null => {
  const parsed = transcriptLangSchema.safeParse(lang);
  return parsed.success ? parsed.data : null;
};

/** The captions viewers and moderators get: only finished ones, with a known language. */
export function captionsOf(row: {
  captions: VideoCue[] | null;
  captionsStatus: string | null;
  lang: string | null;
}): VideoCaptions | null {
  if (row.captionsStatus !== 'done' || !row.captions || row.captions.length === 0) return null;
  return { lang: langOf(row.lang) ?? 'en', cues: row.captions };
}

/** A short fingerprint of the words, so an approval names what was seen. */
export function captionsVersion(row: {
  captions: VideoCue[] | null;
  captionsStatus: string | null;
}) {
  return createHash('sha256')
    .update(JSON.stringify([row.captionsStatus, row.captions ?? []]))
    .digest('hex')
    .slice(0, 16);
}

const notFound = () => new HttpError(404, ErrorCode.NotFound, 'Resource not found.');

type Row = typeof profileVideos.$inferSelect;
/** The MP4, its WebM rendition, or the poster. */
export type VideoPart = 'video' | 'webm' | 'poster';

/**
 * Video prompts (phase 76h). An upload is kept in quarantine until the worker scanned and
 * re-encoded it; then it waits for a moderator. Others see it only once approved.
 */
export class VideoService {
  constructor(
    private readonly db: Database,
    private readonly storage: Storage,
    private readonly mediaQueue: MediaQueue,
  ) {}

  /** Who may see whose profile, and whose photos are blurred for whom (phase 66a). */
  private canView?: (viewerId: string, ownerId: string) => Promise<boolean>;
  private blurred?: (viewerId: string, ownerId: string) => Promise<boolean>;
  useVisibility(
    canView: (viewerId: string, ownerId: string) => Promise<boolean>,
    blurred: (viewerId: string, ownerId: string) => Promise<boolean>,
  ): void {
    this.canView = canView;
    this.blurred = blurred;
  }

  private async row(userId: string): Promise<Row | undefined> {
    const [row] = await this.db
      .select()
      .from(profileVideos)
      .where(eq(profileVideos.userId, userId));
    return row;
  }

  async mine(userId: string): Promise<MyVideo> {
    const row = await this.row(userId);
    if (!row) return { video: null };
    // Viewable by its owner once it's out of the pipeline (not while captions are being made).
    const ready =
      row.mediaKey !== null &&
      row.posterKey !== null &&
      (row.status === 'review' || row.status === 'clean');
    return {
      video: {
        id: row.id,
        promptKey: row.promptKey as PromptKey,
        status: row.status as NonNullable<MyVideo['video']>['status'],
        rejectReason: (row.rejectReason as VideoRejectReason | null) ?? null,
        durationMs: row.durationMs,
        url: ready ? videoUrl(row.id) : null,
        posterUrl: ready ? posterUrl(row.id) : null,
        captions: {
          status: (row.captionsStatus as CaptionStatus | null) ?? 'off',
          lang: langOf(row.lang),
          cues: row.captionsStatus === 'done' ? (row.captions ?? []) : [],
        },
      },
    };
  }

  /** A new video replaces the old one at once (the old media is deleted). */
  async upload(
    userId: string,
    promptKey: PromptKey,
    buffer: Buffer,
    /** The app's language: the language spoken, for the captions (phase 80). */
    lang?: TranscriptLang,
  ): Promise<MyVideo> {
    const mime = await sniffVideoType(buffer);
    if (!mime) throw new HttpError(415, ErrorCode.BadRequest, 'Unsupported video format.');
    await this.remove(userId);
    const [row] = await this.db
      .insert(profileVideos)
      .values({ userId, promptKey, ...(lang ? { lang } : {}) })
      .returning({ id: profileVideos.id });
    const key = videoQuarantineKey(userId, row!.id);
    try {
      await this.storage.put(this.storage.buckets.quarantine, key, buffer, mime);
      await this.db
        .update(profileVideos)
        .set({ quarantineKey: key })
        .where(eq(profileVideos.id, row!.id));
      await this.mediaQueue.processVideo({ videoId: row!.id });
    } catch (error) {
      await this.db.delete(profileVideos).where(eq(profileVideos.id, row!.id));
      await this.storage.delete(this.storage.buckets.quarantine, [key]).catch(() => undefined);
      throw error;
    }
    return this.mine(userId);
  }

  async remove(userId: string): Promise<void> {
    const removed = await this.db
      .delete(profileVideos)
      .where(eq(profileVideos.userId, userId))
      .returning();
    await this.deleteMedia(removed);
  }

  private async deleteMedia(rows: Row[], withQuarantine = true): Promise<void> {
    const quarantineKeys = withQuarantine
      ? rows.map((r) => videoQuarantineKey(r.userId, r.id))
      : [];
    const mediaKeys = rows.flatMap((r) =>
      [r.mediaKey, r.posterKey, r.webmKey].filter((k): k is string => k !== null),
    );
    if (quarantineKeys.length + mediaKeys.length === 0) return;
    await this.mediaQueue.deleteObjects({ quarantineKeys, mediaKeys });
  }

  /** Approved videos of these members, for profiles. */
  async forProfiles(ownerIds: string[]): Promise<Map<string, VideoPrompt>> {
    if (ownerIds.length === 0) return new Map();
    const rows = await this.db
      .select()
      .from(profileVideos)
      .where(and(inArray(profileVideos.userId, ownerIds), eq(profileVideos.status, 'clean')));
    return new Map(
      rows.map((r) => [
        r.userId,
        {
          id: r.id,
          promptKey: r.promptKey as PromptKey,
          url: videoUrl(r.id),
          posterUrl: posterUrl(r.id),
          durationMs: r.durationMs ?? 0,
          captions: captionsOf(r),
        },
      ]),
    );
  }

  /**
   * Phase 80: the owner corrects the words (the timing stays) or turns captions off. Corrected
   * words on an approved video send it back to review: nothing unreviewed is shown. Turning them
   * off needs no review.
   */
  async setCaptions(userId: string, input: CaptionsInput): Promise<MyVideo> {
    // The row is locked, so this and a moderator's decision can't cross (phase 80 review).
    await this.db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(profileVideos)
        .where(eq(profileVideos.userId, userId))
        .for('update');
      if (!row || (row.status !== 'review' && row.status !== 'clean')) throw notFound();
      if (input.lines === null) {
        await tx
          .update(profileVideos)
          .set({ captions: null, captionsStatus: 'off', captionFlags: [] })
          .where(eq(profileVideos.id, row.id));
        return;
      }
      const cues = row.captionsStatus === 'done' ? (row.captions ?? []) : [];
      if (cues.length === 0 || input.lines.length !== cues.length) {
        throw new HttpError(409, ErrorCode.Conflict, 'The captions changed. Load them again.');
      }
      const lines = input.lines;
      // Only what the owner wrote is refused: a line the model got wrong can still be fixed while
      // another flagged line waits for the moderator.
      const changed = lines.filter((text, i) => text !== cues[i]!.text);
      if (changed.length === 0) return;
      if ([...changed, changed.join(' ')].some((text) => checkHarm(text).flagged)) {
        throw new HttpError(
          422,
          ErrorCode.ValidationError,
          'This may hurt. Please choose kinder words.',
        );
      }
      const harm = checkHarm(lines.join(' '));
      await tx
        .update(profileVideos)
        .set({
          captions: cues.map((cue, i) => ({ ...cue, text: lines[i]! })),
          // What the filter sees in the whole text stays as a note for the moderator.
          captionFlags: harm.flagged ? harm.categories : [],
          // New words are always reviewed: back to the moderators if it was already shown.
          status: 'review',
          reviewedBy: null,
          reviewedAt: null,
        })
        .where(eq(profileVideos.id, row.id));
    });
    return this.mine(userId);
  }

  /**
   * The file, for its owner (also while it waits for review) or for someone who may see the
   * owner's profile with unblurred photos, once approved. Everyone else: 404.
   */
  async open(
    viewerId: string,
    videoId: string,
    part: VideoPart,
    range?: string,
  ): Promise<StoredObject> {
    const [row] = await this.db.select().from(profileVideos).where(eq(profileVideos.id, videoId));
    if (!row) throw notFound();
    const own = row.userId === viewerId;
    if (!own) {
      if (row.status !== 'clean') throw notFound();
      if (!(await this.canView?.(viewerId, row.userId))) throw notFound();
      if (await this.blurred?.(viewerId, row.userId)) throw notFound();
    } else if (row.status !== 'review' && row.status !== 'clean') {
      throw notFound();
    }
    return this.read(row, part, range);
  }

  private async read(row: Row, part: VideoPart, range?: string): Promise<StoredObject> {
    const key = part === 'video' ? row.mediaKey : part === 'webm' ? row.webmKey : row.posterKey;
    if (!key) throw notFound();
    try {
      return await this.storage.get(
        this.storage.buckets.media,
        key,
        part === 'poster' ? undefined : range,
      );
    } catch (error) {
      if ((error as { name?: string }).name === 'InvalidRange') {
        throw new HttpError(416, ErrorCode.BadRequest, 'Range not satisfiable.');
      }
      if ((error as { name?: string }).name === 'NoSuchKey') throw notFound();
      throw error;
    }
  }

  /** Staff: videos waiting for review, oldest first. */
  async queue(): Promise<AdminVideo[]> {
    const rows = await this.db
      .select({ video: profileVideos, displayName: profiles.displayName })
      .from(profileVideos)
      .leftJoin(profiles, eq(profiles.userId, profileVideos.userId))
      .where(eq(profileVideos.status, 'review'))
      .orderBy(asc(profileVideos.createdAt))
      .limit(100);
    return rows.map(({ video, displayName }) => this.adminView(video, displayName));
  }

  adminView(video: Row, displayName: string | null): AdminVideo {
    return {
      id: video.id,
      userId: video.userId,
      displayName: displayName ?? '',
      promptKey: video.promptKey as PromptKey,
      durationMs: video.durationMs,
      url: adminVideoUrl(video.id),
      posterUrl: adminPosterUrl(video.id),
      submittedAt: video.createdAt.toISOString(),
      captions: captionsOf(video),
      captionFlags: video.captionFlags,
      captionsVersion: captionsVersion(video),
    };
  }

  /** A member's processed video (waiting or approved), for a report. */
  async ofReported(userId: string): Promise<AdminVideo | null> {
    const row = await this.row(userId);
    if (!row || (row.status !== 'review' && row.status !== 'clean')) return null;
    return this.adminView(row, null);
  }

  /** Staff: any processed video (the queue, or a reported member's). */
  async adminOpen(videoId: string, part: VideoPart, range?: string) {
    const [row] = await this.db.select().from(profileVideos).where(eq(profileVideos.id, videoId));
    if (!row || (row.status !== 'review' && row.status !== 'clean')) throw notFound();
    return this.read(row, part, range);
  }

  /**
   * Approve (shown on the profile) or reject (media deleted, the reason shown to the owner). An
   * approved video can be rejected later too (e.g. after a report).
   */
  async decide(staffId: string, videoId: string, decision: VideoDecision): Promise<void> {
    // The row is locked for the decision: the words approved are the words the moderator saw.
    const row = await this.db.transaction(async (tx) => {
      const [locked] = await tx
        .select()
        .from(profileVideos)
        .where(eq(profileVideos.id, videoId))
        .for('update');
      if (!locked) throw notFound();
      // Phase 77e: nobody reviews their own video (like reports that involve them).
      if (locked.userId === staffId) {
        throw new HttpError(403, ErrorCode.Forbidden, 'You cannot review your own video.');
      }
      const allowedFrom = decision.approve ? ['review'] : ['review', 'clean'];
      if (!allowedFrom.includes(locked.status)) {
        throw new HttpError(409, ErrorCode.Conflict, 'This video is not waiting for a decision.');
      }
      // Phase 80: the owner corrected the captions after the moderator loaded them.
      if (decision.approve && decision.captionsVersion !== captionsVersion(locked)) {
        throw new HttpError(409, ErrorCode.Conflict, 'The captions changed. Look again.');
      }
      await tx
        .update(profileVideos)
        .set(
          decision.approve
            ? { status: 'clean', reviewedBy: staffId, reviewedAt: new Date() }
            : {
                status: 'rejected',
                rejectReason: decision.reason!,
                mediaKey: null,
                posterKey: null,
                webmKey: null,
                // The words go with the media.
                captions: null,
                captionFlags: [],
                reviewedBy: staffId,
                reviewedAt: new Date(),
              },
        )
        .where(eq(profileVideos.id, videoId));
      return locked;
    });
    if (!decision.approve) await this.deleteMedia([row], false);
    await audit(this.db, {
      actorId: staffId,
      action: decision.approve ? 'video.approved' : 'video.rejected',
      targetType: 'video',
      targetId: videoId,
      meta: { owner: row.userId, ...(decision.reason ? { reason: decision.reason } : {}) },
    });
  }
}
