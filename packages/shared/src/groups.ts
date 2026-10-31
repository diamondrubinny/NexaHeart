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

const emojiSchema = z.string().trim().min(1).max(8);

export const groupSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  about: z.string(),
  emoji: z.string(),
  members: z.number().int(),
  capacity: z.number().int(),
  joined: z.boolean(),
  archived: z.boolean(),
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
