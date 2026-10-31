# Phase 76c: the Question Game in chat

Part of phase 76 (formats, lenses and groups) in
[market-gaps-2026-10.he.md](../research/market-gaps-2026-10.he.md). Inspired by Bumble's Question
Game, without its catch: **neither answer shows until both people have answered**, so nobody
anchors on the other's answer and nobody is left exposed.

## What

- In a chat, either person taps **"🎲 Question game"**. A card with a light question appears
  (from a fixed bank, translated in all 4 languages; one not yet asked in this chat).
- Each person writes a short answer (up to 280 characters). Until both have answered, each sees
  only "You answered" / "Waiting for {{name}}"; then both answers show together on the card.
- One open question per chat at a time. A new one can start once the open one is answered.
- **The community can turn it off** (Dashboard → Branding → Community, on by default).

## Design

| Part   | Change                                                                                                                                                          |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| shared | `game.ts`: `gameQuestions` (keys), `GAME_ANSWER_MAX`, `startGameSchema`, `gameAnswerSchema`; `message.game` in the message view; instance `community.chatGame`  |
| db     | `message_kind` gains `game`; table `chat_games` (match, question, who started, answer per side, answered at); `messages.game_id`; `instance_settings.chat_game` |
| api    | `POST /v1/matches/:id/game` starts one (card message, realtime to both); `POST /v1/games/:id/answer`; answers pass the harm check (a harmful answer is refused) |
| mobile | Chat: "Question game" button; `GameCard` with the question, my answer, waiting state, then both answers                                                         |
| admin  | Branding → Community: "Question game in chat" checkbox                                                                                                          |

## Security, privacy, accessibility

- **Authorization on the server**: only the two people in the match can start or answer; a
  closed match (unmatched, blocked) refuses. IDs from other chats are 404 (no IDOR).
- **The other person's answer never leaves the server before both answered**: the view is built
  per viewer. Realtime carries ids only; each person fetches their own view.
- **Content safety**: answers pass the same harm check as messages; a harmful answer is refused
  with a request to rephrase (it is not delivered). Answers are part of the chat: reports of the
  card carry them as evidence, they are in the data export, and they are deleted with the chat.
- **No AI**: the questions are a fixed, reviewed list; nothing is sent to a model.
- **Accessibility**: the card is a labelled group; the answer field has a label and a counter;
  the reveal is announced (live region); RTL; contrast; keyboard.

## Tests

- Integration: start → both answer → reveal; the other answer is hidden until then (API and
  realtime view); one open per chat (409); outsiders 404; harmful answer refused; off when the
  community turns it off; a question isn't repeated in a chat.
- e2e (en, he): two browsers play one round; axe 0; screenshots.

## Done

- Shared `game.ts` (16 questions, `GAME_ANSWER_MAX` 280, schemas, `GameView`); `messageKinds` adds
  `game`; instance `community.chatGame`.
- Migration 0086: `message_kind` + `game`, `chat_games` (one open per chat, no repeated question),
  `messages.game_id`, `instance_settings.chat_game`.
- API: `POST /v1/matches/:id/game`, `POST /v1/games/:id/answer`; the view is built per viewer; the
  chat visibility filter, report evidence (`gameEvidence`) and the data export
  (`questionGameAnswers`) include the game.
- App: a "🎲 Question game" button in its own row above the composer (a fifth icon left no room to
  type at 390 px); `GameCard` with a live region for the reveal; the chat list preview.
- Dashboard: Branding → Community checkbox.
- Tests: integration `game.test.ts` (4); e2e `pnpm --dir e2e game` (en, he, two browsers), axe 0;
  screenshots `197-question-game`, `admin-20-chat-game`.
- Next: interest groups, video prompts, Secret Crush.
