// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Diamond Rubinny and NexaHeart contributors · https://nexaheart.com
// Keep the "Powered by NexaHeart" credit: an additional term of the license (see NOTICE).
import { checkHarm } from '@nexaheart/ai';
import { schema, type Database } from '@nexaheart/db';
import { anthemInputSchema, ErrorCode, myAnthemSchema } from '@nexaheart/shared';
import { eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { Auth } from '../../auth/auth.js';
import { currentUser, requireUser } from '../../auth/session.js';
import { HttpError } from '../../plugins/error-handler.js';
import { perUserLimit } from '../../plugins/security.js';

const { profileAnthems } = schema;

/**
 * My song (phase 76g): a title and an artist in my own words, harm-checked when saved. No music
 * service is involved. Others see it on my profile and can like it like a prompt.
 */
export const anthemRoutes: FastifyPluginAsyncZod<{ auth: Auth; db: Database }> = async (
  app,
  { auth, db },
) => {
  app.addHook('preHandler', requireUser(auth));
  const mine = async (userId: string) => {
    const [row] = await db
      .select({ id: profileAnthems.id, title: profileAnthems.title, artist: profileAnthems.artist })
      .from(profileAnthems)
      .where(eq(profileAnthems.userId, userId));
    return { anthem: row ?? null };
  };

  app.get('/v1/me/anthem', { schema: { response: { 200: myAnthemSchema } } }, async (request) =>
    mine(currentUser(request).id),
  );

  app.put(
    '/v1/me/anthem',
    {
      config: perUserLimit(30, 60 * 60_000),
      schema: { body: anthemInputSchema, response: { 200: myAnthemSchema } },
    },
    async (request) => {
      const { title, artist } = request.body;
      // Phase 77d: the line as shown ("title — artist") too, so a phrase split across both fields
      // doesn't pass.
      if ([title, artist, `${title} ${artist}`].some((text) => checkHarm(text).flagged)) {
        throw new HttpError(
          422,
          ErrorCode.ValidationError,
          'This may hurt. Please choose kinder words.',
        );
      }
      const userId = currentUser(request).id;
      await db
        .insert(profileAnthems)
        .values({ userId, title, artist })
        .onConflictDoUpdate({
          target: profileAnthems.userId,
          set: { title, artist, updatedAt: new Date() },
        });
      return mine(userId);
    },
  );

  app.delete(
    '/v1/me/anthem',
    { schema: { response: { 200: myAnthemSchema } } },
    async (request) => {
      await db.delete(profileAnthems).where(eq(profileAnthems.userId, currentUser(request).id));
      return { anthem: null };
    },
  );
};
