// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { schema, type Database } from '@nexaheart/db';
import {
  ErrorCode,
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
    const ready = row.mediaKey !== null && row.posterKey !== null;
    return {
      video: {
        id: row.id,
        promptKey: row.promptKey as PromptKey,
        status: row.status as NonNullable<MyVideo['video']>['status'],
        rejectReason: (row.rejectReason as VideoRejectReason | null) ?? null,
        durationMs: row.durationMs,
        url: ready ? videoUrl(row.id) : null,
        posterUrl: ready ? posterUrl(row.id) : null,
      },
    };
  }

  /** A new video replaces the old one at once (the old media is deleted). */
  async upload(userId: string, promptKey: PromptKey, buffer: Buffer): Promise<MyVideo> {
    const mime = await sniffVideoType(buffer);
    if (!mime) throw new HttpError(415, ErrorCode.BadRequest, 'Unsupported video format.');
    await this.remove(userId);
    const [row] = await this.db
      .insert(profileVideos)
      .values({ userId, promptKey })
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
        },
      ]),
    );
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
    const [row] = await this.db.select().from(profileVideos).where(eq(profileVideos.id, videoId));
    if (!row) throw notFound();
    // Phase 77e: nobody reviews their own video (like reports that involve them).
    if (row.userId === staffId) {
      throw new HttpError(403, ErrorCode.Forbidden, 'You cannot review your own video.');
    }
    const allowedFrom = decision.approve ? ['review'] : ['review', 'clean'];
    if (!allowedFrom.includes(row.status)) {
      throw new HttpError(409, ErrorCode.Conflict, 'This video is not waiting for a decision.');
    }
    const updated = await this.db
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
              reviewedBy: staffId,
              reviewedAt: new Date(),
            },
      )
      .where(and(eq(profileVideos.id, videoId), inArray(profileVideos.status, allowedFrom)))
      .returning({ id: profileVideos.id });
    if (updated.length === 0) {
      throw new HttpError(409, ErrorCode.Conflict, 'This video is not waiting for a decision.');
    }
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
