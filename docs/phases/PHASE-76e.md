# Phase 76e: interest groups

Part of phase 76 in [market-gaps-2026-10.he.md](../research/market-gaps-2026-10.he.md). Niche
communities win on belonging: HER has 30-35+ communities inside the app, Bumble BFF moved to
friend groups, Muzz has Muzz Social. A dating community needs places to meet around a shared
interest, not only a deck.

This phase covers the groups the **community's admins open**. Groups members open (with approval),
and Secret Crush inside a group, come in 76f. (Secret Crush after an event already exists:
phase 71a "Meet again", where only a mutual choice becomes a match.)

## What

- **Groups** (Explore → Groups): a name, a short description and an emoji, opened by the admins
  (e.g. "Hikers", "Board games", "Parents", "Over 40").
- **Join / leave** at any time. Members of a group see its board and who else is in it (first
  name and photo, only people they could see anyway, both ways: blocks, filters, incognito).
- **The board**: short posts (up to 500 characters), newest first. Posts pass the same harm check
  as messages (a harmful post is refused). I can delete my own posts.
- **Report a post**: the post is copied as evidence into an ordinary report against its author
  (the same moderation queue, DSA statement of reasons, appeal).
- **Dashboard → Groups**: open, edit, archive a group; see its posts; remove a post. Size limit per
  group (default 500).
- **No group is visible from outside it**: membership is never on the profile and never sent to
  partner communities.

## Design

| Part   | Change                                                                                                                                                                                                       |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| shared | `groups.ts`: group, post and input schemas; limits; report input `groupPostIds`                                                                                                                              |
| db     | `interest_groups`, `group_members`, `group_posts` (deleted with the author's account, and with the group)                                                                                                    |
| api    | `GET /v1/groups`, `GET /v1/groups/:id`, join/leave, `GET/POST /v1/groups/:id/posts`, `DELETE /v1/group-posts/:id`; admin `/v1/admin/groups` (CRUD, posts, remove post); evidence from group posts in reports |
| mobile | `/groups` list, `/groups/[id]` (about, join, members, board, post, report)                                                                                                                                   |
| admin  | Groups page (MFA staff, like every admin page)                                                                                                                                                               |

## Security, privacy, accessibility

- **Authorization on the server**: only members read a group's board and members; only the author
  deletes a post (admins remove any, recorded in the audit log). IDs from groups I'm not in
  give 404.
- **Visibility both ways**: posts by people blocked or suspended (or after an ended match) are left
  out, both ways; the member list also leaves out people on a break or incognito.
- **Rate limits**: joining, posting, reporting; per-group size limit.
- **Privacy**: membership is personal data (an interest group can reveal sensitive things, e.g.
  "Parents" or a faith group ⚖️): never on the profile, never federated, in the data export,
  deleted with the account. Posts are deleted with the account; removed posts are kept only as
  report evidence.
- **Accessibility**: lists with headings, labelled buttons, the board as a list, RTL, keyboard.

## Tests

- Integration: admins open groups (staff only); join/leave; only members read the board; posts
  harm-checked; blocked people out of each other's lists; delete own post, not others'; admin
  removes a post (logged); report a post (evidence copied); size limit; archived group read-only;
  export and deletion.
- e2e (en, he): an admin opens a group; two members join; one posts; the other sees it and
  reports it; axe 0; screenshots.

## Done

- Shared `groups.ts`; report input `groupPostIds`.
- Migration 0088: `interest_groups`, `group_members`, `group_posts`.
- API: member routes (`/v1/groups…`, `/v1/group-posts/:id`), admin routes (`/v1/admin/groups…`,
  audited); group visibility = active, not on a break, not incognito, no block or ended match
  either way (dating filters don't apply); report evidence from group posts the reporter could
  see; export (`interestGroups`, `groupPosts`); the worker deletes removed posts after 30 days.
- App: `/groups`, `/groups/[id]` (about, join, members, board, post, delete, report); the report
  screen takes `groupPostId`.
- Dashboard: Groups page (open, close/reopen, read posts, remove a post).
- Found on the way: the shared `Loading` spinner had no accessible name; fixed for every screen.
- Tests: integration `groups.test.ts` (5); e2e `pnpm --dir e2e groups` (en, he), axe 0;
  screenshots `200-group-board`, `admin-21-groups`.
- Next (76f): groups members open (with approval), Secret Crush inside a group.
