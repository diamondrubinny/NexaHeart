// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { gameAnswerSchema, messageViewSchema, startGameSchema } from '@nexaheart/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Auth } from '../../auth/auth.js';
import { currentUser, requireUser } from '../../auth/session.js';
import { perUserLimit } from '../../plugins/security.js';
import type { GameService } from './service.js';

const params = z.object({ id: z.uuid() });

/** The Question Game in chat (phase 76c). Both routes require a participant of the match. */
export const gameRoutes: FastifyPluginAsyncZod<{ auth: Auth; games: GameService }> = async (
  app,
  { auth, games },
) => {
  app.addHook('preHandler', requireUser(auth));

  app.post(
    '/v1/matches/:id/game',
    {
      config: perUserLimit(30, 60 * 60_000),
      schema: { params, body: startGameSchema, response: { 201: messageViewSchema } },
    },
    async (request, reply) =>
      reply
        .status(201)
        .send(await games.start(request.params.id, currentUser(request).id, request.body)),
  );

  app.post(
    '/v1/games/:id/answer',
    {
      config: perUserLimit(60, 60 * 60_000),
      schema: { params, body: gameAnswerSchema, response: { 200: messageViewSchema } },
    },
    async (request) => games.answer(request.params.id, currentUser(request).id, request.body),
  );
};
