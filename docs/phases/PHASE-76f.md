# Phase 76f: groups members open, and Secret Crush in a group

Continues [76e](PHASE-76e.md). Two parts:

## A. Groups members open (with the admins' approval)

- **The community decides** (Dashboard → Branding → Community, **off** by default): members may
  propose a group.
- A member proposes a name, a description and an emoji. The proposal waits for the admins
  (Dashboard → Groups → "Waiting for approval": approve or decline). Until then only the member
  sees it ("Waiting for approval").
- Once approved, the member is its **host**: listed as "Host" in the group, and may remove posts
  in it (removed, not deleted, like the admins'; recorded in the audit log). Admins keep full
  control (close the group, remove any post).
- Limits: one proposal waiting at a time, at most 3 groups hosted per member.

## B. Secret Crush in a group

- In a group, I can mark up to **3 people** (across all groups) as a secret crush. Nobody is told.
- If two people mark each other, it's mutual: **a match opens** for both (as after a speed date
  or "Meet again"), and both are told "It's mutual". The crushes are then cleared.
- A one-sided crush is **never shown to anyone**, never counted, and expires after 30 days or when
  either person leaves the group, blocks the other, or the account is deleted.
- Only between members of the same group who can see each other (no blocks, active, not on a
  break, not incognito), and not with someone I already matched.

## Design

| Part   | Change                                                                                                           |
| ------ | ---------------------------------------------------------------------------------------------------------------- |
| shared | proposal input; `group.status`, `group.hosting`; `groupDetail.myCrushes`; instance `community.memberGroups`      |
| db     | `interest_groups.status` (`open`/`pending`), `host_id`; `group_crushes`; `instance_settings.member_groups`       |
| api    | `POST /v1/groups/proposals`; host post removal; admin approve/decline; `PUT/DELETE /v1/groups/:id/crush/:userId` |
| mobile | "Propose a group" form; "Host" label; a 🤫 Secret crush toggle beside each member; "It's mutual" message         |
| admin  | Groups: proposals waiting for approval; Branding: "Members may propose groups"                                   |

## Security, privacy, accessibility

- Every check on the server: proposals only when the community allows it; hosts act only in their
  own group; a crush only on a visible member of a group I'm in (404 otherwise, no IDOR).
- **A crush never leaks**: the API returns only my own crushes; mutual is learned only from the new
  match (no endpoint answers "does X have a crush on me").
- Rate limits: proposals, crushes (and the 3-crush cap stops using crushes as mass likes).
- Crushes are personal data: in the data export, deleted with the account, expire after 30 days.
- Accessibility: the crush control is a labelled toggle with state; RTL; keyboard.

## Tests

- Integration: proposals off by default; propose → pending (invisible to others) → approve → host;
  decline; limits; the host removes a post in their group only. Crush: one-sided invisible;
  mutual → a match for both, crushes cleared; cap of 3; only members who see each other; leaving
  the group or blocking clears crushes; expiry.
- e2e (en, he): propose and approve a group; two members mark each other → "It's mutual" and a
  match; axe 0; screenshots.

## Done

- Shared: proposal schema, `group.status/host/hosting`, `groupDetail.myCrushes/crushesLeft`,
  `crushResult`; instance `community.memberGroups`.
- Migration 0090: `interest_groups.status`, `host_id`, `group_crushes`,
  `instance_settings.member_groups`.
- API: `POST /v1/groups/proposals` (only when allowed; one waiting, at most 3 hosted), admin
  `POST /v1/admin/groups/:id/decision`, host `POST /v1/group-posts/:id/remove` (only in a group
  they host, audited), `PUT/DELETE /v1/groups/:id/crush/:userId` (cap 3, one lock per pair so a
  mutual pair opens one match). Crushes end on leaving the group, on a block, and after 30 days
  (worker). Export: my own crushes only.
- App: `/groups/propose`, "Waiting for approval", host label and removal, a 🤫 toggle per member,
  "It's mutual" with a link to the chat.
- Dashboard: approve/decline proposals; Branding → "Members may propose groups".
- Tests: integration `group-crush.test.ts` (3); e2e `pnpm --dir e2e group-crush` (en, he), axe 0;
  screenshots `201-crush-mutual`, `admin-22-group-proposal`.
- Security (77c, before merge): an independent review found ten issues (the host's name shown to
  outsiders, a block/mutual-crush race, take-back used as mass likes, …), all fixed and tested; see
  `docs/SECURITY_REVIEW.md`. Migration 0091 adds `group_crushes.withdrawn_at`.
- Next: video prompts, a representative song.
