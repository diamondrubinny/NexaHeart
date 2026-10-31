// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { checkHarm, detectScamSignals } from '@nexaheart/ai';
import { schema, type Database } from '@nexaheart/db';
import {
  ErrorCode,
  GROUP_POSTS_PAGE,
  GROUPS_MAX,
  groupInputSchema,
  type AdminGroupPost,
  type Group,
  type GroupDetail,
  type GroupInput,
  type GroupMember,
  type GroupPost,
  type GroupPosts,
  type GroupUpdate,
  type ScamSignal,
  scamSignals,
} from '@nexaheart/shared';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { audit } from '../../lib/audit.js';
import { blurredOwners } from '../../lib/photo-blur.js';
import { HttpError } from '../../plugins/error-handler.js';
import { notContactHidden, notOnBreak, notSeparated } from '../discovery/visibility.js';
import { photoUrl } from '../me/service.js';

const { interestGroups, groupMembers, groupPosts } = schema;

/** Scam warnings stored with a post, as in chat (phase 77b). */
function scamOf(flags: string[]): ScamSignal[] {
  return scamSignals.filter((s) => flags.includes(`scam:${s}`));
}

const notFound = () => new HttpError(404, ErrorCode.NotFound, 'Resource not found.');

type GroupRow = typeof interestGroups.$inferSelect;

/**
 * Who of these people this viewer may see in a group (as a member or as the author of a post), and
 * who may see the viewer: active, not on a break, not incognito, not hidden from their contacts
 * (phase 21), and no block or ended match between them, either way. Groups are social, so dating
 * filters (gender, ages) don't apply here. Phase 77b: posts use the same rule as the member list,
 * so a post can't reveal a member the list hides.
 */
function visibleWith(viewerId: string, other: ReturnType<typeof sql>) {
  return sql`EXISTS (
    SELECT 1 FROM "user" u WHERE u.id = ${other} AND u.status = 'active'
      AND ${notOnBreak('u')} AND NOT u.incognito
      AND ${notSeparated(sql`${viewerId}`, other)}
      AND ${notContactHidden(sql`${viewerId}`, other)})`;
}

/**
 * Interest groups (phase 76e), opened by the community's admins. Members see the board and each
 * other; nobody outside a group sees who is in it. Every read and write checks membership on the
 * server (404 otherwise, so ids from other groups reveal nothing).
 */
export class GroupService {
  constructor(
    private readonly db: Database,
    private readonly now: () => number = Date.now,
  ) {}

  private async counts(): Promise<Map<string, number>> {
    const { rows } = await this.db.execute<{ group_id: string; n: number }>(sql`
      SELECT group_id, count(*)::int AS n FROM group_members GROUP BY group_id`);
    return new Map(rows.map((r) => [r.group_id, r.n]));
  }

  private view(row: GroupRow, members: number, joined: boolean): Group {
    return {
      id: row.id,
      name: row.name,
      about: row.about,
      emoji: row.emoji,
      members,
      capacity: row.capacity,
      joined,
      archived: row.archivedAt !== null,
    };
  }

  private async isMember(groupId: string, userId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ userId: groupMembers.userId })
      .from(groupMembers)
      .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId)));
    return Boolean(row);
  }

  /** Open groups, and archived ones I'm still in (read-only). */
  async list(viewerId: string): Promise<Group[]> {
    const rows = await this.db.select().from(interestGroups).orderBy(interestGroups.name);
    const counts = await this.counts();
    const mine = new Set(
      (
        await this.db
          .select({ groupId: groupMembers.groupId })
          .from(groupMembers)
          .where(eq(groupMembers.userId, viewerId))
      ).map((r) => r.groupId),
    );
    return rows
      .filter((r) => r.archivedAt === null || mine.has(r.id))
      .map((r) => this.view(r, counts.get(r.id) ?? 0, mine.has(r.id)));
  }

  private async group(
    groupId: string,
    viewerId: string,
  ): Promise<{ row: GroupRow; joined: boolean }> {
    const [row] = await this.db.select().from(interestGroups).where(eq(interestGroups.id, groupId));
    if (!row) throw notFound();
    const joined = await this.isMember(groupId, viewerId);
    if (row.archivedAt && !joined) throw notFound();
    return { row, joined };
  }

  private async people(viewerId: string, ids: string[]): Promise<Map<string, GroupMember>> {
    if (ids.length === 0) return new Map();
    const { rows } = await this.db.execute<{
      user_id: string;
      display_name: string;
      photo_id: string | null;
    }>(sql`
      SELECT p.user_id, p.display_name,
        (SELECT ph.id FROM photos ph WHERE ph.user_id = p.user_id AND ph.status = 'clean'
           AND ph.purpose = 'profile' ORDER BY ph.position LIMIT 1) AS photo_id
      FROM profiles p WHERE p.user_id = ANY(${sql.param(ids)}::text[])`);
    const blurred = await blurredOwners(this.db, viewerId, ids);
    return new Map(
      rows.map((r) => [
        r.user_id,
        {
          userId: r.user_id,
          displayName: r.display_name,
          // A blurred photo isn't sent at all in a list this small.
          photoUrl: r.photo_id && !blurred.has(r.user_id) ? photoUrl(r.photo_id) : null,
        },
      ]),
    );
  }

  async detail(groupId: string, viewerId: string): Promise<GroupDetail> {
    const { row, joined } = await this.group(groupId, viewerId);
    const counts = await this.counts();
    let members: GroupMember[] = [];
    if (joined) {
      const { rows } = await this.db.execute<{ user_id: string }>(sql`
        SELECT gm.user_id FROM group_members gm
        WHERE gm.group_id = ${groupId} AND gm.user_id <> ${viewerId}
          AND ${visibleWith(viewerId, sql`gm.user_id`)}
        ORDER BY gm.joined_at
        LIMIT 200`);
      const people = await this.people(
        viewerId,
        rows.map((r) => r.user_id),
      );
      members = rows.flatMap((r) => {
        const p = people.get(r.user_id);
        return p ? [p] : [];
      });
    }
    return { group: this.view(row, counts.get(groupId) ?? 0, joined), members };
  }

  async join(groupId: string, userId: string): Promise<GroupDetail> {
    const { row, joined } = await this.group(groupId, userId);
    if (row.archivedAt) {
      throw new HttpError(409, ErrorCode.Conflict, 'This group is closed.');
    }
    if (!joined) {
      await this.db.transaction(async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`group:${groupId}`}))`);
        const n = await tx.$count(groupMembers, eq(groupMembers.groupId, groupId));
        if (n >= row.capacity) {
          throw new HttpError(409, ErrorCode.Conflict, 'This group is full.');
        }
        await tx.insert(groupMembers).values({ groupId, userId }).onConflictDoNothing();
      });
    }
    return this.detail(groupId, userId);
  }

  async leave(groupId: string, userId: string): Promise<void> {
    const left = await this.db
      .delete(groupMembers)
      .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId)))
      .returning({ userId: groupMembers.userId });
    // Phase 77b: remembered 30 days, so what I saw there can still be reported.
    if (left.length > 0) {
      await this.db
        .insert(schema.groupDepartures)
        .values({ groupId, userId, leftAt: new Date(this.now()) })
        .onConflictDoUpdate({
          target: [schema.groupDepartures.groupId, schema.groupDepartures.userId],
          set: { leftAt: new Date(this.now()) },
        });
    }
  }

  async posts(groupId: string, viewerId: string, before?: string): Promise<GroupPosts> {
    const { joined } = await this.group(groupId, viewerId);
    if (!joined) throw notFound();
    const beforeAt = before ? new Date(before) : null;
    if (beforeAt && Number.isNaN(beforeAt.getTime())) throw notFound();
    const { rows } = await this.db.execute<{
      id: string;
      author_id: string;
      body: string;
      flags: string[];
      created_at: Date;
    }>(sql`
      SELECT gp.id, gp.author_id, gp.body, gp.flags, gp.created_at FROM group_posts gp
      WHERE gp.group_id = ${groupId} AND gp.removed_at IS NULL
        ${beforeAt ? sql`AND gp.created_at < ${beforeAt}` : sql``}
        AND (gp.author_id = ${viewerId} OR (
          -- Harmful posts are refused when written; flagged ones never reach others.
          NOT EXISTS (SELECT 1 FROM unnest(gp.flags) f WHERE f LIKE 'harm:%')
          AND ${visibleWith(viewerId, sql`gp.author_id`)}))
      ORDER BY gp.created_at DESC, gp.id DESC
      LIMIT ${GROUP_POSTS_PAGE + 1}`);
    const page = rows.slice(0, GROUP_POSTS_PAGE);
    const people = await this.people(viewerId, [...new Set(page.map((r) => r.author_id))]);
    const posts: GroupPost[] = page.flatMap((r) => {
      const author = people.get(r.author_id);
      return author
        ? [
            {
              id: r.id,
              mine: r.author_id === viewerId,
              author,
              body: r.body,
              // Phase 77b: others see the same scam warnings as in chat.
              scam: r.author_id === viewerId ? [] : scamOf(r.flags),
              createdAt: new Date(r.created_at).toISOString(),
            },
          ]
        : [];
    });
    const last = page.at(-1);
    return {
      posts,
      next: rows.length > GROUP_POSTS_PAGE && last ? new Date(last.created_at).toISOString() : null,
    };
  }

  async post(groupId: string, authorId: string, body: string): Promise<GroupPost> {
    const { row, joined } = await this.group(groupId, authorId);
    if (!joined) throw notFound();
    if (row.archivedAt) throw new HttpError(409, ErrorCode.Conflict, 'This group is closed.');
    if (checkHarm(body).flagged) {
      throw new HttpError(
        422,
        ErrorCode.ValidationError,
        'This post may hurt. Please choose kinder words.',
      );
    }
    const flags = detectScamSignals(body, 0).map((s) => `scam:${s}`);
    const [inserted] = await this.db
      .insert(groupPosts)
      .values({ groupId, authorId, body, flags })
      .returning();
    const author = (await this.people(authorId, [authorId])).get(authorId)!;
    return {
      id: inserted!.id,
      mine: true,
      author,
      body,
      scam: [],
      createdAt: inserted!.createdAt.toISOString(),
    };
  }

  /**
   * Only the author deletes their own post. Phase 77b: like an unsent message, it disappears for
   * everyone at once but is kept 30 days for moderation (a report can still copy it), then purged.
   */
  async deletePost(postId: string, userId: string): Promise<void> {
    const [post] = await this.db
      .select({ removedAt: groupPosts.removedAt })
      .from(groupPosts)
      .where(and(eq(groupPosts.id, postId), eq(groupPosts.authorId, userId)));
    if (!post) throw notFound();
    if (post.removedAt) return; // already gone (removed by the admins or deleted before)
    await this.db
      .update(groupPosts)
      .set({ removedAt: new Date(this.now()) })
      .where(eq(groupPosts.id, postId));
  }

  // --- Dashboard ---

  async listAll(): Promise<Group[]> {
    const rows = await this.db.select().from(interestGroups).orderBy(interestGroups.name);
    const counts = await this.counts();
    return rows.map((r) => this.view(r, counts.get(r.id) ?? 0, false));
  }

  async create(actorId: string, input: GroupInput): Promise<Group> {
    const values = groupInputSchema.parse(input);
    if ((await this.db.$count(interestGroups)) >= GROUPS_MAX) {
      throw new HttpError(409, ErrorCode.Conflict, `At most ${GROUPS_MAX} groups.`);
    }
    const [row] = await this.db
      .insert(interestGroups)
      .values({ ...values, createdBy: actorId })
      .returning();
    await audit(this.db, {
      actorId,
      action: 'group.create',
      targetType: 'group',
      targetId: row!.id,
    });
    return this.view(row!, 0, false);
  }

  async update(actorId: string, id: string, patch: GroupUpdate): Promise<Group> {
    const { archived, ...rest } = patch;
    const [row] = await this.db
      .update(interestGroups)
      .set({
        ...rest,
        ...(archived === undefined ? {} : { archivedAt: archived ? new Date(this.now()) : null }),
      })
      .where(eq(interestGroups.id, id))
      .returning();
    if (!row) throw notFound();
    await audit(this.db, {
      actorId,
      action: 'group.update',
      targetType: 'group',
      targetId: id,
      meta: { fields: Object.keys(patch).sort().join(',') },
    });
    return this.view(row, (await this.counts()).get(id) ?? 0, false);
  }

  async adminPosts(groupId: string): Promise<AdminGroupPost[]> {
    const rows = await this.db
      .select({
        id: groupPosts.id,
        authorId: groupPosts.authorId,
        authorName: schema.profiles.displayName,
        body: groupPosts.body,
        createdAt: groupPosts.createdAt,
      })
      .from(groupPosts)
      .innerJoin(schema.profiles, eq(schema.profiles.userId, groupPosts.authorId))
      .where(and(eq(groupPosts.groupId, groupId), isNull(groupPosts.removedAt)))
      .orderBy(desc(groupPosts.createdAt))
      .limit(200);
    return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
  }

  /** Removed, not deleted: kept 30 days for moderation (and as report evidence), never shown. */
  async removePost(actorId: string, postId: string): Promise<void> {
    const updated = await this.db
      .update(groupPosts)
      .set({ removedAt: new Date(this.now()) })
      .where(and(eq(groupPosts.id, postId), isNull(groupPosts.removedAt)))
      .returning({ id: groupPosts.id, authorId: groupPosts.authorId });
    if (updated.length === 0) throw notFound();
    await audit(this.db, {
      actorId,
      action: 'group.post.remove',
      targetType: 'user',
      targetId: updated[0]!.authorId,
    });
  }
}
