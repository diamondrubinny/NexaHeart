// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { checkHarm } from '@nexaheart/ai';
import { schema, type Database } from '@nexaheart/db';
import { ErrorCode, myPollSchema, profilePollSchema } from '@nexaheart/shared';
import { eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { Auth } from '../../auth/auth.js';
import { currentUser, requireUser } from '../../auth/session.js';
import { HttpError } from '../../plugins/error-handler.js';
import { perUserLimit } from '../../plugins/security.js';

const { profilePolls } = schema;

/**
 * My prompt poll (phase 76d): a question and 2-3 answers in my own words, harm-checked when saved.
 * Others see it on my profile; a pick travels with a like. Nothing is counted.
 */
export const pollRoutes: FastifyPluginAsyncZod<{ auth: Auth; db: Database }> = async (
  app,
  { auth, db },
) => {
  app.addHook('preHandler', requireUser(auth));

  app.get('/v1/me/poll', { schema: { response: { 200: myPollSchema } } }, async (request) => {
    const [row] = await db
      .select({ question: profilePolls.question, answers: profilePolls.answers })
      .from(profilePolls)
      .where(eq(profilePolls.userId, currentUser(request).id));
    return { poll: row ?? null };
  });

  app.put(
    '/v1/me/poll',
    {
      config: perUserLimit(30, 60 * 60_000),
      schema: { body: profilePollSchema, response: { 200: myPollSchema } },
    },
    async (request) => {
      const { question, answers } = request.body;
      if ([question, ...answers].some((text) => checkHarm(text).flagged)) {
        throw new HttpError(
          422,
          ErrorCode.ValidationError,
          'This poll may hurt. Please choose kinder words.',
        );
      }
      const userId = currentUser(request).id;
      await db
        .insert(profilePolls)
        .values({ userId, question, answers })
        .onConflictDoUpdate({
          target: profilePolls.userId,
          set: { question, answers, updatedAt: new Date() },
        });
      return { poll: { question, answers } };
    },
  );

  app.delete('/v1/me/poll', { schema: { response: { 200: myPollSchema } } }, async (request) => {
    await db.delete(profilePolls).where(eq(profilePolls.userId, currentUser(request).id));
    return { poll: null };
  });
};
