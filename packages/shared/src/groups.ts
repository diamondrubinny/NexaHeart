// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { z } from 'zod';
import { scamSignals } from './signals.js';

/**
 * Phase 76e: interest groups opened by the community's admins. Membership is personal data (a group
 * can reveal something sensitive): never on the profile, never sent to partner communities.
 */
export const GROUP_NAME_MAX = 40;
export const GROUP_ABOUT_MAX = 300;
export const GROUP_POST_MAX = 500;
/** Members per group unless the admins set another limit. */
export const GROUP_SIZE_DEFAULT = 500;
export const GROUP_SIZE_MAX = 5000;
export const GROUPS_MAX = 100;
/** Posts per page of a board. */
export const GROUP_POSTS_PAGE = 30;
/** Phase 76f: groups a member may host, and secret crushes a member may have at once. */
export const GROUPS_HOSTED_MAX = 3;
export const SECRET_CRUSHES_MAX = 3;
export const SECRET_CRUSH_DAYS = 30;

/**
 * Phase 77c: an emoji only (pictographs, their modifiers and joiners), not short text: the group
 * list is public to members, and words here would skip the harm check.
 */
const emojiSchema = z
  .string()
  .trim()
  .min(1)
  .max(16)
  .regex(
    /^(?:\p{Extended_Pictographic}|\p{Emoji_Modifier}|\p{Regional_Indicator}|\u200d|\ufe0f)+$/u,
    {
      message: 'An emoji only',
    },
  );

export const groupSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  about: z.string(),
  emoji: z.string(),
  members: z.number().int(),
  capacity: z.number().int(),
  joined: z.boolean(),
  archived: z.boolean(),
  /** Phase 76f: a member's proposal waits for the admins ('pending'); only its author sees it. */
  status: z.enum(['open', 'pending']),
  /** Phase 76f: the member hosting it (proposed it), if any. */
  host: z.object({ userId: z.string(), displayName: z.string() }).nullable(),
  /** Phase 76f: I host it. */
  hosting: z.boolean(),
});
export type Group = z.infer<typeof groupSchema>;

export const groupMemberSchema = z.object({
  userId: z.string(),
  displayName: z.string(),
  photoUrl: z.string().nullable(),
});
export type GroupMember = z.infer<typeof groupMemberSchema>;

export const groupPostSchema = z.object({
  id: z.uuid(),
  mine: z.boolean(),
  author: groupMemberSchema,
  body: z.string(),
  /** Phase 77b: scam warnings on someone else's post (as in chat); empty on my own. */
  scam: z.array(z.enum(scamSignals)),
  createdAt: z.string(),
});
export type GroupPost = z.infer<typeof groupPostSchema>;

export const groupDetailSchema = z.object({
  group: groupSchema,
  /** Only for members; people this member can see, both ways. */
  members: z.array(groupMemberSchema),
  /** Phase 76f: whom I marked as a secret crush here (only mine; never anyone else's). */
  myCrushes: z.array(z.string()),
  /** Phase 76f: secret crushes I have left (across all groups). */
  crushesLeft: z.number().int(),
});
export type GroupDetail = z.infer<typeof groupDetailSchema>;

export const groupPostsSchema = z.object({
  posts: z.array(groupPostSchema),
  /** Pass as `before` for the next page; null at the end. */
  next: z.string().nullable(),
});
export type GroupPosts = z.infer<typeof groupPostsSchema>;

export const groupPostInputSchema = z
  .object({ body: z.string().trim().min(1).max(GROUP_POST_MAX) })
  .strict();

export const groupInputSchema = z
  .object({
    name: z.string().trim().min(2).max(GROUP_NAME_MAX),
    about: z.string().trim().max(GROUP_ABOUT_MAX).default(''),
    emoji: emojiSchema.default('💬'),
    capacity: z.number().int().min(2).max(GROUP_SIZE_MAX).default(GROUP_SIZE_DEFAULT),
  })
  .strict();
export type GroupInput = z.input<typeof groupInputSchema>;

export const groupUpdateSchema = z
  .object({
    name: z.string().trim().min(2).max(GROUP_NAME_MAX),
    about: z.string().trim().max(GROUP_ABOUT_MAX),
    emoji: emojiSchema,
    capacity: z.number().int().min(2).max(GROUP_SIZE_MAX),
    archived: z.boolean(),
  })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to change' });
export type GroupUpdate = z.infer<typeof groupUpdateSchema>;

/** A post as the admins see it (with the author's id, for moderation). */
export const adminGroupPostSchema = z.object({
  id: z.uuid(),
  authorId: z.string(),
  authorName: z.string(),
  body: z.string(),
  createdAt: z.string(),
});
export type AdminGroupPost = z.infer<typeof adminGroupPostSchema>;

/** Phase 76f: a member proposes a group; the admins approve it. */
export const groupProposalSchema = z
  .object({
    name: z.string().trim().min(2).max(GROUP_NAME_MAX),
    about: z.string().trim().max(GROUP_ABOUT_MAX).default(''),
    emoji: emojiSchema.default('💬'),
  })
  .strict();
export type GroupProposal = z.input<typeof groupProposalSchema>;

/** Phase 76f: the result of marking a secret crush: a match only when it's mutual. */
export const crushResultSchema = z.object({
  detail: groupDetailSchema,
  /** Set when the crush was mutual: the match both of us now have. */
  matchId: z.uuid().nullable(),
});
export type CrushResult = z.infer<typeof crushResultSchema>;
