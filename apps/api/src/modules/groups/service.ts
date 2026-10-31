// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { checkHarm, detectScamSignals } from '@nexaheart/ai';
import { schema, type Database } from '@nexaheart/db';
import {
  ErrorCode,
  GROUP_POSTS_PAGE,
  GROUPS_HOSTED_MAX,
  GROUPS_MAX,
  groupInputSchema,
  groupProposalSchema,
  SECRET_CRUSH_DAYS,
  SECRET_CRUSHES_MAX,
  type CrushResult,
  type GroupProposal,
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
import { crushPairLock, type DiscoveryService } from '../discovery/service.js';
import { notContactHidden, notOnBreak, notSeparated } from '../discovery/visibility.js';
import { photoUrl } from '../me/service.js';

const { interestGroups, groupMembers, groupPosts, groupCrushes } = schema;

/** A crush still counts for this long (phase 76f). */
const crushFresh = sql.raw(`now() - interval '${SECRET_CRUSH_DAYS} days'`);

/** Scam warnings stored with a post, as in chat (phase 77b). */
function scamOf(flags: string[]): ScamSignal[] {
  return scamSignals.filter((s) => flags.includes(`scam:${s}`));
}

const notFound = () => new HttpError(404, ErrorCode.NotFound, 'Resource not found.');

type GroupRow = typeof interestGroups.$inferSelect;
type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

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
    /** Phase 76f: a mutual secret crush opens a match. */
    private readonly discovery?: Pick<DiscoveryService, 'matchFromMutualCrush'>,
  ) {}

  /**
   * Hosts' names. Phase 77c: a host is a member, so their name follows the same rule as the member
   * list: only for someone they can see both ways (null `viewerId` is staff, who see all).
   */
  private async hosts(rows: GroupRow[], viewerId: string | null): Promise<Map<string, string>> {
    const ids = [...new Set(rows.flatMap((r) => (r.hostId ? [r.hostId] : [])))];
    if (ids.length === 0) return new Map();
    const { rows: names } = await this.db.execute<{ user_id: string; display_name: string }>(sql`
      SELECT p.user_id, p.display_name FROM profiles p
      WHERE p.user_id = ANY(${sql.param(ids)}::text[])
        ${viewerId === null ? sql`` : sql`AND (p.user_id = ${viewerId} OR ${visibleWith(viewerId, sql`p.user_id`)})`}`);
    return new Map(names.map((n) => [n.user_id, n.display_name]));
  }

  private async counts(): Promise<Map<string, number>> {
    const { rows } = await this.db.execute<{ group_id: string; n: number }>(sql`
      SELECT group_id, count(*)::int AS n FROM group_members GROUP BY group_id`);
    return new Map(rows.map((r) => [r.group_id, r.n]));
  }

  private view(
    row: GroupRow,
    members: number,
    joined: boolean,
    viewerId: string | null,
    hostNames: Map<string, string>,
  ): Group {
    // Phase 77c: who hosts a group is shown only inside it (staff and the host themselves aside),
    // like any membership.
    const hostName =
      row.hostId && (viewerId === null || joined || row.hostId === viewerId)
        ? hostNames.get(row.hostId)
        : undefined;
    return {
      status: row.status === 'pending' ? 'pending' : 'open',
      host: row.hostId && hostName ? { userId: row.hostId, displayName: hostName } : null,
      hosting: viewerId !== null && row.hostId === viewerId,
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
    const shown = rows.filter(
      (r) =>
        // A proposal is visible only to its author until the admins approve it.
        (r.status !== 'pending' || r.createdBy === viewerId) &&
        (r.archivedAt === null || mine.has(r.id)),
    );
    const hosts = await this.hosts(shown, viewerId);
    return shown.map((r) => this.view(r, counts.get(r.id) ?? 0, mine.has(r.id), viewerId, hosts));
  }

  private async group(
    groupId: string,
    viewerId: string,
  ): Promise<{ row: GroupRow; joined: boolean }> {
    const [row] = await this.db.select().from(interestGroups).where(eq(interestGroups.id, groupId));
    if (!row) throw notFound();
    if (row.status === 'pending' && row.createdBy !== viewerId) throw notFound();
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
    const crushes = joined ? await this.myCrushes(viewerId) : [];
    return {
      group: this.view(
        row,
        counts.get(groupId) ?? 0,
        joined,
        viewerId,
        await this.hosts([row], viewerId),
      ),
      members,
      myCrushes: crushes
        .filter((c) => c.groupId === groupId && !c.withdrawn)
        .map((c) => c.targetId),
      // Phase 77c: a taken-back crush still counts until it expires.
      crushesLeft: Math.max(0, SECRET_CRUSHES_MAX - crushes.length),
    };
  }

  async join(groupId: string, userId: string): Promise<GroupDetail> {
    const { row, joined } = await this.group(groupId, userId);
    if (row.archivedAt || row.status === 'pending') {
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
    await this.db.transaction(async (tx) => {
      // Phase 77c: the same locks as a crush on me or by me, so none can slip in after I left.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`crush-user:${userId}`}))`);
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`crush-target:${userId}`}))`);
      await this.leaveIn(tx, groupId, userId);
    });
  }

  private async leaveIn(tx: Tx, groupId: string, userId: string): Promise<void> {
    const left = await tx
      .delete(groupMembers)
      .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId)))
      .returning({ userId: groupMembers.userId });
    // Phase 77c: a host who leaves stops hosting (the admins still run the group).
    await tx
      .update(interestGroups)
      .set({ hostId: null })
      .where(and(eq(interestGroups.id, groupId), eq(interestGroups.hostId, userId)));
    // Phase 77b: remembered 30 days, so what I saw there can still be reported.
    if (left.length > 0) {
      await tx
        .insert(schema.groupDepartures)
        .values({ groupId, userId, leftAt: new Date(this.now()) })
        .onConflictDoUpdate({
          target: [schema.groupDepartures.groupId, schema.groupDepartures.userId],
          set: { leftAt: new Date(this.now()) },
        });
    }
    // Phase 76f: secret crushes made in this group, mine and on me, end when I leave it.
    await tx.execute(sql`DELETE FROM group_crushes
      WHERE group_id = ${groupId} AND (user_id = ${userId} OR target_id = ${userId})`);
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
    if (row.archivedAt || row.status === 'pending') {
      throw new HttpError(409, ErrorCode.Conflict, 'This group is closed.');
    }
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
    const hosts = await this.hosts(rows, null);
    return rows.map((r) => this.view(r, counts.get(r.id) ?? 0, false, null, hosts));
  }

  async create(actorId: string, input: GroupInput): Promise<Group> {
    const values = groupInputSchema.parse(input);
    const row = await this.db.transaction(async (tx) => {
      // Phase 77c: one lock for everyone who adds a group, so the cap holds under concurrency.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('groups-count'))`);
      if ((await tx.$count(interestGroups)) >= GROUPS_MAX) {
        throw new HttpError(409, ErrorCode.Conflict, `At most ${GROUPS_MAX} groups.`);
      }
      const [inserted] = await tx
        .insert(interestGroups)
        .values({ ...values, createdBy: actorId })
        .returning();
      return inserted!;
    });
    await audit(this.db, {
      actorId,
      action: 'group.create',
      targetType: 'group',
      targetId: row.id,
    });
    return this.view(row, 0, false, null, new Map());
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
    return this.view(
      row,
      (await this.counts()).get(id) ?? 0,
      false,
      null,
      await this.hosts([row], null),
    );
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

  /**
   * Removed, not deleted: kept 30 days for moderation (and as report evidence), never shown.
   * `asHost` (phase 76f): a member removes a post only in a group they host.
   */
  async removePost(actorId: string, postId: string, asHost = false): Promise<void> {
    const updated = await this.db
      .update(groupPosts)
      .set({ removedAt: new Date(this.now()) })
      .where(
        and(
          eq(groupPosts.id, postId),
          isNull(groupPosts.removedAt),
          asHost
            ? sql`EXISTS (SELECT 1 FROM interest_groups g WHERE g.id = ${groupPosts.groupId}
                AND g.host_id = ${actorId} AND g.status = 'open' AND g.archived_at IS NULL
                AND EXISTS (SELECT 1 FROM group_members gm
                            WHERE gm.group_id = g.id AND gm.user_id = ${actorId}))`
            : sql`true`,
        ),
      )
      .returning({ id: groupPosts.id, authorId: groupPosts.authorId });
    if (updated.length === 0) throw notFound();
    await audit(this.db, {
      actorId,
      action: asHost ? 'group.post.remove.host' : 'group.post.remove',
      targetType: 'user',
      targetId: updated[0]!.authorId,
    });
  }

  // --- Phase 76f: groups members propose ---

  /** Read fresh: the community turning it off takes effect at once. */
  private async memberGroupsOn(): Promise<boolean> {
    const [row] = await this.db
      .select({ on: schema.instanceSettings.memberGroups })
      .from(schema.instanceSettings)
      .limit(1);
    return row?.on ?? false;
  }

  async propose(userId: string, input: GroupProposal): Promise<Group> {
    if (!(await this.memberGroupsOn())) {
      throw new HttpError(403, ErrorCode.Forbidden, 'Members can’t propose groups here.');
    }
    const values = groupProposalSchema.parse(input);
    if ([values.name, values.about].some((text) => text && checkHarm(text).flagged)) {
      throw new HttpError(
        422,
        ErrorCode.ValidationError,
        'This may hurt. Please choose kinder words.',
      );
    }
    const row = await this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`group-host:${userId}`}))`);
      // Phase 77c: the community-wide cap too, under one lock for everyone who adds a group.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('groups-count'))`);
      const { rows } = await tx.execute<{ pending: number; hosted: number }>(sql`
        SELECT count(*) FILTER (WHERE status = 'pending')::int AS pending,
               count(*) FILTER (WHERE status = 'open' AND archived_at IS NULL)::int AS hosted
        FROM interest_groups WHERE host_id = ${userId}`);
      if ((rows[0]?.pending ?? 0) > 0) {
        throw new HttpError(409, ErrorCode.Conflict, 'You already have a proposal waiting.');
      }
      if ((rows[0]?.hosted ?? 0) >= GROUPS_HOSTED_MAX) {
        throw new HttpError(409, ErrorCode.Conflict, `At most ${GROUPS_HOSTED_MAX} groups each.`);
      }
      if ((await tx.$count(interestGroups)) >= GROUPS_MAX) {
        throw new HttpError(409, ErrorCode.Conflict, `At most ${GROUPS_MAX} groups.`);
      }
      const [inserted] = await tx
        .insert(interestGroups)
        .values({ ...values, status: 'pending', createdBy: userId, hostId: userId })
        .returning();
      return inserted!;
    });
    await audit(this.db, {
      actorId: userId,
      action: 'group.propose',
      targetType: 'group',
      targetId: row.id,
    });
    return this.view(row, 0, false, userId, await this.hosts([row], userId));
  }

  /** Approving opens the group, with its host as the first member; declining deletes it. */
  async decide(actorId: string, id: string, approve: boolean): Promise<void> {
    // Phase 77c: only a proposal still waiting is decided, in one statement (two admins or a
    // double click can't approve and decline the same group, or decline one already open).
    const done = await this.db.transaction(async (tx) => {
      if (!approve) {
        const deleted = await tx
          .delete(interestGroups)
          .where(and(eq(interestGroups.id, id), eq(interestGroups.status, 'pending')))
          .returning({ id: interestGroups.id });
        return deleted.length > 0;
      }
      const [opened] = await tx
        .update(interestGroups)
        .set({ status: 'open' })
        .where(and(eq(interestGroups.id, id), eq(interestGroups.status, 'pending')))
        .returning({ hostId: interestGroups.hostId });
      if (!opened) return false;
      if (opened.hostId) {
        await tx
          .insert(groupMembers)
          .values({ groupId: id, userId: opened.hostId })
          .onConflictDoNothing();
      }
      return true;
    });
    if (!done) throw notFound();
    await audit(this.db, {
      actorId,
      action: approve ? 'group.approve' : 'group.decline',
      targetType: 'group',
      targetId: id,
    });
  }

  // --- Phase 76f: Secret Crush ---

  /** My fresh crushes, including ones I took back (they count until they expire). */
  private async myCrushes(
    userId: string,
  ): Promise<{ targetId: string; groupId: string; withdrawn: boolean }[]> {
    const { rows } = await this.db.execute<{
      target_id: string;
      group_id: string;
      withdrawn: boolean;
    }>(sql`
      SELECT target_id, group_id, withdrawn_at IS NOT NULL AS withdrawn FROM group_crushes
      WHERE user_id = ${userId} AND created_at > ${crushFresh}`);
    return rows.map((r) => ({
      targetId: r.target_id,
      groupId: r.group_id,
      withdrawn: r.withdrawn,
    }));
  }

  /**
   * Mark (or take back) a secret crush on a member of this group. Nobody is ever told about a
   * one-sided crush; a mutual one opens a match for both and both crushes are cleared.
   *
   * Phase 77c: every check runs inside one transaction, under the locks a leave or a block takes
   * (so neither can slip between the check and the write); a crush taken back still counts toward
   * the cap until it expires (no mass liking by giving and taking back); archived groups are
   * read-only; the match itself is opened by matchFromMutualCrush, which re-checks everything under
   * the per-pair lock a block takes.
   */
  async crush(
    groupId: string,
    userId: string,
    targetId: string,
    on: boolean,
  ): Promise<CrushResult> {
    const { row, joined } = await this.group(groupId, userId);
    if (!joined || row.status !== 'open' || row.archivedAt) throw notFound();
    if (targetId === userId) throw notFound();
    const mutual = await this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`crush-user:${userId}`}))`);
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`crush-target:${targetId}`}))`);
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext(${crushPairLock(userId, targetId)}))`,
      );
      if (!on) {
        await tx
          .update(groupCrushes)
          .set({ withdrawnAt: new Date(this.now()) })
          .where(and(eq(groupCrushes.userId, userId), eq(groupCrushes.targetId, targetId)));
        return false;
      }
      // Both still members here; the target someone I can see, who can see me.
      const { rows: ok } = await tx.execute<{ ok: boolean }>(sql`
        SELECT EXISTS (SELECT 1 FROM group_members gm WHERE gm.group_id = ${groupId}
          AND gm.user_id = ${targetId} AND ${visibleWith(userId, sql`gm.user_id`)}
          AND ${visibleWith(targetId, sql`${userId}`)})
          AND EXISTS (SELECT 1 FROM group_members me WHERE me.group_id = ${groupId}
          AND me.user_id = ${userId}) AS ok`);
      if (!ok[0]?.ok) throw notFound();
      const { rows: matched } = await tx.execute<{ id: string }>(sql`
        SELECT id FROM matches WHERE unmatched_at IS NULL
          AND ((user_a = ${userId} AND user_b = ${targetId}) OR (user_a = ${targetId} AND user_b = ${userId}))`);
      if (matched.length > 0) {
        throw new HttpError(409, ErrorCode.Conflict, 'You already matched.');
      }
      const { rows } = await tx.execute<{ n: number }>(sql`
        SELECT count(*)::int AS n FROM group_crushes
        WHERE user_id = ${userId} AND created_at > ${crushFresh} AND target_id <> ${targetId}`);
      if ((rows[0]?.n ?? 0) >= SECRET_CRUSHES_MAX) {
        throw new HttpError(
          409,
          ErrorCode.Conflict,
          `At most ${SECRET_CRUSHES_MAX} secret crushes.`,
        );
      }
      await tx
        .insert(groupCrushes)
        .values({ userId, targetId, groupId })
        .onConflictDoUpdate({
          target: [groupCrushes.userId, groupCrushes.targetId],
          set: { groupId, withdrawnAt: null },
        });
      const { rows: back } = await tx.execute<{ ok: number }>(sql`
        SELECT 1 AS ok FROM group_crushes
        WHERE user_id = ${targetId} AND target_id = ${userId} AND created_at > ${crushFresh}
          AND withdrawn_at IS NULL`);
      if (back.length === 0) return false;
      await tx.execute(sql`DELETE FROM group_crushes
        WHERE (user_id = ${userId} AND target_id = ${targetId})
           OR (user_id = ${targetId} AND target_id = ${userId})`);
      return true;
    });
    const matchId =
      mutual && this.discovery
        ? await this.discovery.matchFromMutualCrush(userId, targetId, groupId)
        : null;
    return { detail: await this.detail(groupId, userId), matchId };
  }
}
